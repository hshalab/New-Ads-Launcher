import { createAdminClient } from "@/lib/supabase/admin"
import { getFacebookConnection } from "@/lib/auth"
import type { ActionConfig } from "@/lib/workflow-types"
import { sendEmail } from "@/lib/send-email"
import { buildNotificationEmail } from "@/lib/email-template"
import { sendLarkMessage, sendLarkGroupMessage } from "@/lib/send-lark"
import { buildMetaHeaders, sequentialMap } from "@/lib/meta-secure-fetch"

const GRAPH = "https://graph.facebook.com/v25.0"

export interface TriggerPayload {
  // File/media context
  fileId?: string
  fileName?: string
  fileUrl?: string
  mimeType?: string
  thumbnailUrl?: string
  // Entity context
  entityIds?: string[]
  entityNames?: string[]
  // Metric trigger variables (Performance Monitoring, ROAS, CPA, Spend)
  summary?: string            // {{trigger.summary}} — ready-made full sentence
  metricFormatted?: string    // {{trigger.metric}} — e.g. "Spend", "ROAS"
  metricRaw?: string          // {{trigger.metricRaw}}
  previousValue?: string      // {{trigger.previousValue}}
  currentValue?: string       // {{trigger.currentValue}}
  actualChange?: string       // {{trigger.actualChange}} — e.g. "-80.1"
  direction?: string          // {{trigger.direction}} — "increased" | "decreased"
  directionPastTense?: string // {{trigger.directionPastTense}} — "increased by" | "decreased by"
  threshold?: string          // {{trigger.threshold}}
  comparisonLabel?: string    // {{trigger.comparisonLabel}} — "Day over Day"
  comparisonWindow?: string   // {{trigger.comparisonWindow}}
  monitoringLevel?: string    // {{trigger.monitoringLevel}} — "Campaign" | "Ad Set"
  qualifyingCount?: string    // {{trigger.qualifyingCount}}
  // System
  currentDate?: string        // {{trigger.currentDate}}
  currentDateTime?: string    // {{trigger.currentDateTime}}
}

export interface StepLog {
  ts: string
  msg: string
  level: "info" | "warn" | "error"
}

export interface ActionResult {
  event: string
  status: "success" | "failed" | "skipped"
  message: string
  data?: Record<string, any>
}

export interface ExecutionResult {
  status: "success" | "failed" | "skipped" | "pending_delay" | "pending_approval"
  logs: StepLog[]
  triggerPayload: TriggerPayload
  actionResults: ActionResult[]
  durationMs: number
  executionDbId?: string
  resumeAt?: string      // ISO timestamp — when to resume after delay
  approvalId?: string    // DB id of automation_approvals record
}

function addLog(logs: StepLog[], msg: string, level: StepLog["level"] = "info") {
  logs.push({ ts: new Date().toISOString(), msg, level })
}

// Resolve target IDs from template expression or static config.
// Supports {{trigger.qualifyingAdIds}}, {{trigger.qualifyingCampaignIds}}, etc.
function resolveTargetIds(a: ActionConfig & Record<string, any>, p: TriggerPayload): string[] {
  const expr = a.actionTargetExpression ?? ""
  if (expr && expr.includes("{{trigger.qualifying")) return p.entityIds ?? []
  if (expr && !expr.startsWith("{{")) {
    return expr.split(",").map((s: string) => s.trim()).filter(Boolean)
  }
  return a.targetIds?.length ? a.targetIds : p.entityIds?.length ? p.entityIds : (a.targetId ? [a.targetId] : [])
}

async function execMetaAction(
  action: ActionConfig & Record<string, any>,
  payload: TriggerPayload,
  token: string,
  logs: StepLog[],
  isTest = false
): Promise<ActionResult> {
  const ev = action.event

  // ── TEST MODE: simulate without calling Meta API ──────────────────────────
  if (isTest) {
    const ids = resolveTargetIds(action, payload)
    const targetDesc = ids.length ? `IDs: ${ids.slice(0, 3).join(", ")}${ids.length > 3 ? "…" : ""}` : "no targets"
    addLog(logs, `[TEST MODE] Would execute ${ev} on ${targetDesc} — skipped to protect real ads`, "info")
    return { event: ev, status: "skipped", message: `[TEST] Would execute ${ev} (${targetDesc})` }
  }

  switch (ev) {
    // ── Pause ────────────────────────────────────────────────────────────────
    case "pause_ad":
    case "pause_campaign":
    case "pause_adset": {
      const ids = resolveTargetIds(action, payload)
      if (!ids.length) return { event: ev, status: "skipped", message: "No target IDs configured" }
      const results = await sequentialMap(ids, async id => {
        const res = await fetch(`${GRAPH}/${id}`, {
          method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", ...buildMetaHeaders(token) },
          body: new URLSearchParams({ status: "PAUSED" }).toString(),
        })
        return res.json()
      })
      const failed = results.filter(r => r.error)
      if (failed.length) return { event: ev, status: "failed", message: failed[0].error.message }
      addLog(logs, `${ev}: paused ${ids.length} item(s)`)
      return { event: ev, status: "success", message: `Paused ${ids.length} item(s)`, data: { ids } }
    }

    // ── Enable ────────────────────────────────────────────────────────────────
    case "enable_ad":
    case "enable_campaign":
    case "enable_adset": {
      const ids = resolveTargetIds(action, payload)
      if (!ids.length) return { event: ev, status: "skipped", message: "No target IDs configured" }
      const results = await sequentialMap(ids, async id => {
        const res = await fetch(`${GRAPH}/${id}`, {
          method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", ...buildMetaHeaders(token) },
          body: new URLSearchParams({ status: "ACTIVE" }).toString(),
        })
        return res.json()
      })
      const failed = results.filter(r => r.error)
      if (failed.length) return { event: ev, status: "failed", message: failed[0].error.message }
      addLog(logs, `${ev}: enabled ${ids.length} item(s)`)
      return { event: ev, status: "success", message: `Enabled ${ids.length} item(s)`, data: { ids } }
    }

    // ── Budget ────────────────────────────────────────────────────────────────
    case "increase_budget":
    case "decrease_budget":
    case "change_budget": {
      const ids = resolveTargetIds(action, payload)
      if (!ids.length) return { event: ev, status: "skipped", message: "No target IDs configured" }

      const budgetField = action.budgetType === "lifetime" ? "lifetime_budget" : "daily_budget"
      const change      = action.budgetChange
      const operation   = action.budgetOperation ?? (ev === "increase_budget" ? "increase" : ev === "decrease_budget" ? "decrease" : "increase")
      const amount      = action.budgetAmount ?? change?.amount ?? 0
      const isPercent   = (action.budgetAmountType ?? change?.unit ?? "%") === "percentage" || (change?.unit === "%")

      if (!amount || amount <= 0) return { event: ev, status: "skipped", message: "No valid budget amount configured — amount must be > 0" }

      const updates = await sequentialMap(ids, async id => {
        const fetchRes = await fetch(`${GRAPH}/${id}?fields=${budgetField}`, { headers: buildMetaHeaders(token) })
        const fetchData = await fetchRes.json()
        if (fetchData.error) return { id, error: fetchData.error.message }

        const current = parseInt(fetchData[budgetField] ?? "0")
        let next: number
        if (operation === "set") {
          next = Math.round(amount * 100)
        } else if (isPercent) {
          const factor = operation === "increase" ? (1 + amount / 100) : (1 - amount / 100)
          next = Math.round(current * factor)
        } else {
          const delta = Math.round(amount * 100)
          next = operation === "increase" ? current + delta : current - delta
        }
        next = Math.max(next, 100)

        const res = await fetch(`${GRAPH}/${id}`, {
          method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", ...buildMetaHeaders(token) },
          body: new URLSearchParams({ [budgetField]: String(next) }).toString(),
        })
        const data = await res.json()
        if (data.error) return { id, error: data.error.message }
        return { id, prev: current, next }
      })

      const failed = updates.filter(r => r.error)
      if (failed.length) return { event: ev, status: "failed", message: (failed[0] as any).error }
      addLog(logs, `${ev}: updated budget for ${ids.length} item(s)`)
      return { event: ev, status: "success", message: `Budget updated for ${ids.length} item(s)`, data: { updates } }
    }

    // ── Duplicate ─────────────────────────────────────────────────────────────
    case "duplicate_ad":
    case "duplicate_adset":
    case "duplicate_campaign": {
      const ids = resolveTargetIds(action, payload)
      if (!ids.length) return { event: ev, status: "skipped", message: "No target IDs configured" }

      const copies     = action.duplicateCopies ?? 1
      const statusOpt  = action.duplicateStatus ?? "PAUSED"
      const deepCopy   = ev !== "duplicate_ad"

      const results = await sequentialMap(ids, async id => {
        const qs = new URLSearchParams({ status_option: statusOpt, deep_copy: String(deepCopy) })
        if (copies > 1) qs.set("count", String(copies))
        const res = await fetch(`${GRAPH}/${id}/copies?${qs}`, { method: "POST", headers: buildMetaHeaders(token) })
        const data = await res.json()
        if (data.error) return { id, error: data.error.message }
        const newId = data.copied_adset_id ?? data.copied_campaign_id ?? data.id
        return { id, newId }
      })

      const failed = results.filter(r => (r as any).error)
      if (failed.length) return { event: ev, status: "failed", message: (failed[0] as any).error }
      addLog(logs, `${ev}: duplicated ${ids.length} item(s)`)
      return { event: ev, status: "success", message: `Duplicated ${ids.length} item(s)`, data: { results } }
    }

    // ── Swap Creative ─────────────────────────────────────────────────────────
    case "swap_creative": {
      const adIds      = resolveTargetIds(action, payload)
      const newCreativeId = action.newCreativeId ?? action.creativeId
      if (!adIds.length) return { event: ev, status: "skipped", message: "No target ad IDs configured" }
      if (!newCreativeId) return { event: ev, status: "skipped", message: "No new creative ID configured" }

      const results = await sequentialMap(adIds, async adId => {
        const res = await fetch(`${GRAPH}/${adId}`, {
          method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", ...buildMetaHeaders(token) },
          body: new URLSearchParams({ creative: JSON.stringify({ creative_id: newCreativeId }) }).toString(),
        })
        const data = await res.json()
        if (data.error) return { adId, error: data.error.message }
        return { adId, success: true }
      })

      const failed = results.filter(r => (r as any).error)
      if (failed.length) return { event: ev, status: "failed", message: (failed[0] as any).error }
      addLog(logs, `${ev}: swapped creative on ${adIds.length} ad(s) → creative ${newCreativeId}`)
      return { event: ev, status: "success", message: `Creative swapped on ${adIds.length} ad(s)`, data: { results } }
    }

    // ── Set Minimum Spend ─────────────────────────────────────────────────────
    case "set_minimum_spend": {
      const ids    = resolveTargetIds(action, payload)
      const amount = action.minSpendAmount ?? action.minimumSpendAmount ?? action.amount ?? 0
      if (!ids.length) return { event: ev, status: "skipped", message: "No target ad set IDs configured" }
      if (!amount)     return { event: ev, status: "skipped", message: "No minimum spend amount configured" }

      const results = await sequentialMap(ids, async id => {
        const res = await fetch(`${GRAPH}/${id}`, {
          method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", ...buildMetaHeaders(token) },
          body: new URLSearchParams({ spend_cap: String(Math.round(amount * 100)) }).toString(),
        })
        const data = await res.json()
        if (data.error) return { id, error: data.error.message }
        return { id, spendCap: amount }
      })

      const failed = results.filter(r => (r as any).error)
      if (failed.length) return { event: ev, status: "failed", message: (failed[0] as any).error }
      addLog(logs, `${ev}: set minimum spend $${amount} on ${ids.length} item(s)`)
      return { event: ev, status: "success", message: `Set minimum spend $${amount} on ${ids.length} item(s)`, data: { results } }
    }

    // ── Meta Automated Rules ──────────────────────────────────────────────────
    case "create_rule": {
      const adAccountId = action.adAccountId ?? payload.entityIds?.[0]
      if (!adAccountId) return { event: ev, status: "skipped", message: "No ad account ID configured" }

      const actId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`
      const ruleBody = new URLSearchParams({
        account_id:   actId,
        name:         action.ruleName ?? "Auto Rule",
        evaluation_spec: JSON.stringify({ evaluation_type: "SCHEDULE", filters: action.ruleFilters ?? [] }),
        execution_spec:  JSON.stringify({ execution_type: action.ruleExecutionType ?? "PAUSE" }),
        schedule_spec:   JSON.stringify({ schedule_type: "DAILY" }),
        status:       "ENABLED",
      })

      const res  = await fetch(`${GRAPH}/me/ad_rules`, { method: "POST", body: ruleBody, headers: buildMetaHeaders(token) })
      const data = await res.json()
      if (data.error) return { event: ev, status: "failed", message: data.error.message }
      addLog(logs, `${ev}: created rule "${action.ruleName}" (id: ${data.id})`)
      return { event: ev, status: "success", message: `Created rule "${action.ruleName}"`, data: { ruleId: data.id } }
    }

    case "toggle_rule": {
      const ruleId = action.ruleId
      const enable = action.enable !== false
      if (!ruleId) return { event: ev, status: "skipped", message: "No rule ID configured" }

      const res  = await fetch(`${GRAPH}/${ruleId}`, {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", ...buildMetaHeaders(token) },
        body: new URLSearchParams({ status: enable ? "ENABLED" : "DISABLED" }).toString(),
      })
      const data = await res.json()
      if (data.error) return { event: ev, status: "failed", message: data.error.message }
      addLog(logs, `${ev}: ${enable ? "enabled" : "disabled"} rule ${ruleId}`)
      return { event: ev, status: "success", message: `Rule ${enable ? "enabled" : "disabled"}`, data: { ruleId } }
    }

    case "apply_existing_rule": {
      const ruleId = action.ruleId
      if (!ruleId) return { event: ev, status: "skipped", message: "No rule ID configured" }

      const res  = await fetch(`${GRAPH}/${ruleId}/execute`, { method: "POST", headers: buildMetaHeaders(token) })
      const data = await res.json()
      if (data.error) return { event: ev, status: "failed", message: data.error.message }
      addLog(logs, `${ev}: executed rule ${ruleId}`)
      return { event: ev, status: "success", message: `Rule executed`, data: { ruleId } }
    }

    default:
      addLog(logs, `WARNING: Unsupported action type: ${ev} — skipping`, "warn")
      return { event: ev, status: "skipped", message: `Action "${ev}" not yet implemented` }
  }
}

async function execNotification(
  action: ActionConfig,
  payload: TriggerPayload,
  automationName: string,
  logs: StepLog[],
  orgId = ""
): Promise<ActionResult> {
  const notif = action.notification
  if (!notif) return { event: "send_notification", status: "skipped", message: "No notification config" }

  // Replace ALL template variables
  function resolveVars(text: string): string {
    const now = new Date()
    return text
      .replace(/\{\{trigger\.summary\}\}/g,            payload.summary            ?? "")
      .replace(/\{\{trigger\.metric\}\}/g,              payload.metricFormatted    ?? "")
      .replace(/\{\{trigger\.metricFormatted\}\}/g,     payload.metricFormatted    ?? "")
      .replace(/\{\{trigger\.metricRaw\}\}/g,           payload.metricRaw          ?? "")
      .replace(/\{\{trigger\.previousValue\}\}/g,       payload.previousValue      ?? "")
      .replace(/\{\{trigger\.currentValue\}\}/g,        payload.currentValue       ?? "")
      .replace(/\{\{trigger\.actualChange\}\}/g,        payload.actualChange       ?? "")
      .replace(/\{\{trigger\.direction\}\}/g,           payload.direction          ?? "")
      .replace(/\{\{trigger\.directionPastTense\}\}/g,  payload.directionPastTense ?? "")
      .replace(/\{\{trigger\.threshold\}\}/g,           payload.threshold          ?? "")
      .replace(/\{\{trigger\.comparisonLabel\}\}/g,     payload.comparisonLabel    ?? "")
      .replace(/\{\{trigger\.comparisonWindow\}\}/g,    payload.comparisonWindow   ?? "")
      .replace(/\{\{trigger\.monitoringLevel\}\}/g,     payload.monitoringLevel    ?? "")
      .replace(/\{\{trigger\.qualifyingCount\}\}/g,     payload.qualifyingCount    ?? "")
      .replace(/\{\{trigger\.entityName\}\}/g,          payload.fileName           ?? payload.entityNames?.[0] ?? "")
      .replace(/\{\{trigger\.qualifyingEntityIDs\}\}/g, (payload.entityIds ?? []).join(", "))
      .replace(/\{\{trigger\.currentDate\}\}/g,         payload.currentDate        ?? now.toLocaleDateString("en-US"))
      .replace(/\{\{trigger\.currentDateTime\}\}/g,     payload.currentDateTime    ?? now.toLocaleString("en-US"))
      .replace(/\{\{filename\}\}/g,                     payload.fileName           ?? "")
      .replace(/\{\{date\}\}/g,                         payload.currentDate        ?? now.toLocaleDateString("en-US"))
  }

  const rawMessage = notif.customMessage || `Your automation "${automationName}" was triggered.${payload.summary ? `\n\n${payload.summary}` : ""}`
  const messageBody = resolveVars(rawMessage)
  const results: string[] = []
  const errors: string[]  = []

  // ── Fetch metrics report if configured ────────────────────────────────────
  let reportSection = ""
  if ((notif as any).includeReport && (notif as any).reportAdAccountId) {
    try {
      const db      = createAdminClient()
      const actId   = (notif as any).reportAdAccountId
      const period  = (notif as any).reportPeriod ?? "yesterday"
      const ago     = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString().split("T")[0]
      const since   = period === "yesterday" ? ago(1) : period === "last_7d" ? ago(7) : ago(30)
      const until   = ago(1)

      const { data: rows } = await db
        .from("campaign_insights_snapshots")
        .select("campaign_name,spend,impressions,clicks,purchases,purchase_value,roas,ctr,cpm")
        .eq("org_id", orgId)
        .eq("fb_ad_account_id", actId.startsWith("act_") ? actId : `act_${actId}`)
        .gte("date", since).lte("date", until)
        .order("spend", { ascending: false })
        .limit(10)

      if (rows?.length) {
        const totSpend = rows.reduce((s, r) => s + (parseFloat(r.spend ?? "0") || 0), 0)
        const totPurch = rows.reduce((s, r) => s + (r.purchases ?? 0), 0)
        const totVal   = rows.reduce((s, r) => s + (parseFloat(r.purchase_value ?? "0") || 0), 0)
        const avgROAS  = totSpend > 0 ? (totVal / totSpend).toFixed(2) : "—"

        reportSection = `\n\n━━━ METRICS REPORT (${period.replace("_", " ")}) ━━━\n`
        reportSection += `Total Spend:     $${totSpend.toFixed(2)}\n`
        reportSection += `Total Purchases: ${totPurch}\n`
        reportSection += `Revenue:         $${totVal.toFixed(2)}\n`
        reportSection += `Avg ROAS:        ${avgROAS}x\n`
        reportSection += `\nTop Campaigns:\n`
        const byCampaign: Record<string, number> = {}
        for (const r of rows) { byCampaign[r.campaign_name ?? "Unknown"] = (byCampaign[r.campaign_name ?? "Unknown"] ?? 0) + (parseFloat(r.spend ?? "0") || 0) }
        Object.entries(byCampaign).sort((a, b) => b[1] - a[1]).slice(0, 5).forEach(([name, spend]) => {
          reportSection += `  • ${name.length > 40 ? name.slice(0, 38) + "…" : name}: $${spend.toFixed(2)}\n`
        })
      } else {
        reportSection = `\n\n[No metrics data found for this period. Sync data via Insights → Sync Now]`
      }
    } catch { /* silent */ }
  }

  const finalMessage = messageBody + reportSection

  // Build metrics object for HTML template
  let metricsObj: any = undefined
  if ((notif as any).includeReport && (notif as any).reportAdAccountId && reportSection) {
    // Parse the metrics we already fetched above
    const spendMatch    = reportSection.match(/Total Spend:\s+\$([0-9.]+)/)
    const purchMatch    = reportSection.match(/Total Purchases:\s+(\d+)/)
    const revMatch      = reportSection.match(/Revenue:\s+\$([0-9.]+)/)
    const roasMatch     = reportSection.match(/Avg ROAS:\s+([0-9.]+)/)
    metricsObj = {
      totalSpend:    parseFloat(spendMatch?.[1] ?? "0"),
      purchases:     parseInt(purchMatch?.[1] ?? "0"),
      revenue:       parseFloat(revMatch?.[1] ?? "0"),
      roas:          parseFloat(roasMatch?.[1] ?? "0"),
      period:        (notif as any).reportPeriod ?? "yesterday",
      campaigns:     [], // campaigns already in reportSection text
    }
  }

  const { subject, html, text: emailText } = buildNotificationEmail({
    automationName,
    message: finalMessage || undefined,
    metrics: metricsObj,
    status: "info",
  })

  const recipients = notif.emailRecipients ?? []
  if (recipients.length) {
    const result = await sendEmail({ to: recipients, subject, text: emailText, html })
    if (!result.ok) {
      addLog(logs, `Email failed: ${result.error}`, "warn")
      errors.push(result.error ?? "Email failed")
    } else {
      addLog(logs, `Email sent to ${recipients.join(", ")}`)
      results.push(`email:${recipients.join(",")}`)
    }
  }

  // ── Slack webhook ───────────────────────────────────────────────────────────
  const slackWebhookUrl = notif.slackWebhookUrl ?? process.env.SLACK_WEBHOOK_URL
  if (slackWebhookUrl) {
    const slackBody = {
      text: `*${automationName}*\n${messageBody}`,
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: `*🤖 Automation: ${automationName}*\n${notif.customMessage || "Triggered successfully."}` }
        },
        ...(payload.fileName ? [{
          type: "context",
          elements: [{ type: "mrkdwn", text: `📎 File: ${payload.fileName}` }]
        }] : [])
      ]
    }
    // SEC-007: restrict Slack webhooks to hooks.slack.com to prevent SSRF
    let isSlackHost = false
    try { const u = new URL(slackWebhookUrl); isSlackHost = u.protocol === "https:" && u.host === "hooks.slack.com" } catch {}
    if (!isSlackHost) {
      addLog(logs, `Slack notification skipped: webhook URL must be an https://hooks.slack.com/... URL`, "warn")
    } else {
      const res = await fetch(slackWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(slackBody),
      })
      if (!res.ok) {
        addLog(logs, `Slack notification failed (${res.status})`, "warn")
      } else {
        addLog(logs, `Slack notification sent`)
        results.push("slack")
      }
    }
  }

  // ── Lark via API ─────────────────────────────────────────────────────────────
  const larkRecipients: string[] = (notif as any).larkRecipients ?? []
  const larkChatId: string = (notif as any).larkChatId ?? ""
  if (larkRecipients.length || larkChatId) {
    const larkTitle = `${automationName}`
    if (larkRecipients.length) {
      const larkResult = await sendLarkMessage({ recipients: larkRecipients, title: larkTitle, message: finalMessage })
      if (!larkResult.ok) addLog(logs, `Lark DM failed: ${larkResult.error}`, "warn")
      else { addLog(logs, `Lark DM sent to ${larkRecipients.join(", ")}`); results.push(`lark:${larkRecipients.join(",")}`) }
    }
    if (larkChatId) {
      const larkResult = await sendLarkGroupMessage({ chatId: larkChatId, title: larkTitle, message: finalMessage })
      if (!larkResult.ok) addLog(logs, `Lark group failed: ${larkResult.error}`, "warn")
      else { addLog(logs, `Lark group message sent`); results.push("lark:group") }
    }
  }

  if (!results.length) {
    const msg = errors.length ? `Email failed: ${errors[0]}` : "No notification channels configured"
    return { event: "send_notification", status: errors.length ? "failed" : "skipped", message: msg }
  }
  return { event: "send_notification", status: "success", message: `Notification sent via: ${results.join(", ")}` }
}

// ─── Google Sheets action executor ───────────────────────────────────────────

async function execSheetsAction(
  action: ActionConfig,
  payload: TriggerPayload,
  logs: StepLog[],
  isTest = false
): Promise<ActionResult> {
  const ev = action.event
  if (isTest) {
    addLog(logs, `[TEST MODE] Would execute ${ev} on Google Sheets — skipped`, "info")
    return { event: ev, status: "skipped", message: `[TEST] Would execute ${ev} on Sheets` }
  }
  const spreadsheetId = action.actionSheetsSpreadsheetId
  const sheetName     = action.actionSheetsSheetName ?? "Sheet1"

  if (!spreadsheetId) {
    addLog(logs, `${ev}: no spreadsheet configured`, "warn")
    return { event: ev, status: "skipped", message: "No spreadsheet configured" }
  }

  try {
    const { saReadRange } = await import("@/lib/google-sheets-sa")
    const { google }      = await import("googleapis")

    const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
    if (!raw) return { event: ev, status: "failed", message: "GOOGLE_SERVICE_ACCOUNT_JSON not configured" }

    const auth = new (await import("googleapis")).google.auth.GoogleAuth({
      credentials: JSON.parse(raw),
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    })
    const sheets = google.sheets({ version: "v4", auth })

    if (ev === "add_sheet_row" || ev === "update_sheet_row") {
      const mappings: { column: string; value: string }[] = action.actionSheetsColumnMappings ?? []

      // Build row values by resolving template variables
      const resolveValue = (template: string) => {
        return template
          .replace("{{filename}}", payload.fileName ?? "")
          .replace("{{fileUrl}}", payload.fileUrl ?? "")
          .replace("{{date}}", new Date().toISOString().split("T")[0])
          .replace("{{mimeType}}", payload.mimeType ?? "")
      }

      const values = mappings.map(m => resolveValue(m.value))

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: sheetName,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [values] },
      })

      addLog(logs, `${ev}: appended row to ${sheetName}`)
      return { event: ev, status: "success", message: `Row appended to ${sheetName}` }
    }

    if (ev === "update_sheet_cell") {
      const cellRef  = action.actionSheetsCellRef ?? "A1"
      const value    = action.actionSheetsCellValue ?? ""
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!${cellRef}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [[value]] },
      })
      addLog(logs, `${ev}: updated ${sheetName}!${cellRef} = "${value}"`)
      return { event: ev, status: "success", message: `Cell ${cellRef} updated` }
    }

    return { event: ev, status: "skipped", message: `Unsupported sheets action: ${ev}` }
  } catch (err: any) {
    addLog(logs, `${ev} error: ${err.message}`, "error")
    return { event: ev, status: "failed", message: err.message }
  }
}

// ─── Media Library action executor ───────────────────────────────────────────

async function execMediaLibraryAction(
  action: ActionConfig,
  payload: TriggerPayload,
  orgId: string,
  logs: StepLog[],
  isTest = false
): Promise<ActionResult> {
  const ev = action.event
  if (isTest) {
    addLog(logs, `[TEST MODE] Would upload to Media Library — skipped`, "info")
    return { event: ev, status: "skipped", message: `[TEST] Would upload "${payload.fileName ?? "file"}" to Media Library` }
  }
  if (!payload.fileUrl) return { event: ev, status: "skipped", message: "No file URL in trigger payload" }

  try {
    const db       = createAdminClient()
    const boardId  = action.actionMediaBoardId

    // Build file name from naming template
    const template = action.actionMediaNamingTemplate ?? "{originalName}"
    const ext      = payload.fileName?.match(/\.[^.]+$/)?.[0] ?? ""
    const baseName = payload.fileName?.replace(/\.[^.]+$/, "") ?? "file"
    const fileName = template
      .replace("{originalName}", baseName)
      .replace("{date}", new Date().toISOString().split("T")[0])
      .replace("{boardName}", action.actionMediaBoardName ?? "")
      .replace("{counter}", "1") + ext

    // Insert creative record
    const { data: creative, error } = await db
      .from("creatives")
      .insert({
        org_id:     orgId,
        user_id:    "00000000-0000-0000-0000-000000000000", // system
        file_name:  fileName,
        file_url:   payload.fileUrl,
        media_type: (payload.mimeType ?? "").startsWith("video") ? "video" : "image",
        status:     "ready",
        tags:       [],
      })
      .select("id")
      .single()

    if (error) return { event: ev, status: "failed", message: error.message }

    // Associate with board if specified
    if (boardId && creative?.id) {
      await db.from("board_assets").insert({ board_id: boardId, creative_id: creative.id })
    }

    addLog(logs, `${ev}: uploaded "${fileName}" to media library`)
    return { event: ev, status: "success", message: `Uploaded "${fileName}" to media library`, data: { creativeId: creative?.id } }
  } catch (err: any) {
    addLog(logs, `${ev} error: ${err.message}`, "error")
    return { event: ev, status: "failed", message: err.message }
  }
}

// ─── Launch Ad action executor ────────────────────────────────────────────────

async function execLaunchAdAction(
  action: ActionConfig & Record<string, any>,
  payload: TriggerPayload,
  token: string,
  orgId: string,
  logs: StepLog[],
  isTest = false
): Promise<ActionResult> {
  const ev = "launch_ad"

  const adAccountId  = action.launchAdAccountId
  const targetAdsets = action.launchTargetAdsets ?? []
  const status       = action.launchInitialStatus ?? "PAUSED"
  const headline     = action.launchHeadline ?? ""
  const primaryText  = action.launchPrimaryText ?? ""
  const description  = action.launchDescription ?? ""
  const linkUrl      = action.launchLinkUrl ?? ""
  const cta          = action.launchCta ?? "LEARN_MORE"
  const nameTemplate = action.launchAdNameTemplate ?? "{{filename}} - {{date}}"

  if (!adAccountId) return { event: ev, status: "skipped", message: "No ad account configured" }
  if (targetAdsets.length === 0) return { event: ev, status: "skipped", message: "No target ad sets configured" }
  if (!linkUrl) return { event: ev, status: "failed", message: "Link URL is required for Launch Ad" }

  // ── TEST MODE: simulate without creating real ads ─────────────────────────
  if (isTest) {
    addLog(logs, `[TEST MODE] Would launch ad into ${targetAdsets.length} ad set(s) — skipped to protect real ads`, "info")
    return { event: ev, status: "skipped", message: `[TEST] Would launch ad into ${targetAdsets.length} ad set(s): ${targetAdsets.slice(0, 2).join(", ")}` }
  }

  // Resolve name template
  const date     = new Date().toISOString().split("T")[0]
  const filename = payload.fileName?.replace(/\.[^/.]+$/, "") ?? ""
  const adName   = nameTemplate
    .replace(/\{\{filename\}\}/g, filename)
    .replace(/\{\{date\}\}/g, date)
    .replace(/\{\{aiName\}\}/g, filename)

  // Get creative assets from DB if we have a fileId
  let fbImageHash: string | undefined
  let fbVideoId: string | undefined
  let fbThumbnailUrl: string | undefined
  let pageId: string | undefined

  if (payload.fileId) {
    const db = createAdminClient()
    const { data: creative } = await db
      .from("creatives")
      .select("fb_image_hash, fb_video_id, fb_thumbnail_url, fb_image_url")
      .eq("id", payload.fileId)
      .single()

    if (!creative) {
      addLog(logs, `launch_ad: creative not found for fileId=${payload.fileId}`, "warn")
      return { event: "launch_ad", status: "failed", message: `Creative record not found (id: ${payload.fileId})` }
    }

    fbImageHash   = creative.fb_image_hash ?? undefined
    fbVideoId     = creative.fb_video_id   ?? undefined
    fbThumbnailUrl= creative.fb_thumbnail_url ?? undefined

    // Get page from ad account
    const { data: page } = await db
      .from("pages")
      .select("fb_page_id")
      .eq("org_id", orgId)
      .limit(1)
      .single()
    pageId = page?.fb_page_id
  }

  if (!fbImageHash && !fbVideoId) {
    return { event: ev, status: "failed", message: "Creative has no Facebook asset (image hash or video ID). Upload to Meta first." }
  }

  // Import createAd from lib/facebook
  const { createAd, getVideoThumbnail, isFreshThumbnailUrl } = await import("@/lib/facebook")

  // Refresh missing or expired Meta CDN thumbnails before createAd's write gate.
  if (fbVideoId && !isFreshThumbnailUrl(fbThumbnailUrl)) {
    fbThumbnailUrl = (await getVideoThumbnail(fbVideoId, token)) || undefined
    if (fbThumbnailUrl && payload.fileId) {
      await createAdminClient().from("creatives").update({ fb_thumbnail_url: fbThumbnailUrl }).eq("id", payload.fileId)
    }
  }

  // Launch into each target ad set
  const launchResults: any[] = []
  const launchErrors:  any[] = []

  for (const adsetId of targetAdsets) {
    try {
      const ad = await createAd(adAccountId, token, {
        name:          adName,
        adset_id:      adsetId,
        page_id:       pageId ?? "",
        image_hash:    fbImageHash,
        video_id:      fbVideoId,
        thumbnail_url: fbThumbnailUrl,
        title:         headline,
        body:          primaryText,
        description,
        cta,
        link_url:      linkUrl,
        status,
      })
      addLog(logs, `launch_ad: created ad "${adName}" in adset ${adsetId} → ${ad.id}`)
      launchResults.push({ adsetId, adId: ad.id, adName })
    } catch (err: any) {
      addLog(logs, `launch_ad: failed for adset ${adsetId}: ${err.message}`, "error")
      launchErrors.push({ adsetId, error: err.message })
    }
  }

  if (launchResults.length === 0) {
    return { event: ev, status: "failed", message: launchErrors[0]?.error ?? "All ad launches failed", data: { launchErrors } }
  }

  const msg = `Launched ${launchResults.length} ad(s)${launchErrors.length ? `, ${launchErrors.length} failed` : ""}`
  return {
    event: ev,
    status: launchErrors.length > 0 && launchResults.length === 0 ? "failed" : "success",
    message: msg,
    data: { launchResults, launchErrors },
  }
}

export async function executeAutomation(
  automationId: string,
  orgId: string,
  options: {
    fileId?: string
    fileName?: string
    fileUrl?: string
    mimeType?: string
    thumbnailUrl?: string
    isTest?: boolean
    startFromStep?: number
    entityIds?: string[]
    entityNames?: string[]
    summary?: string
    metricFormatted?: string
    metricRaw?: string
    previousValue?: string
    currentValue?: string
    actualChange?: string
    direction?: string
    directionPastTense?: string
    threshold?: string
    comparisonLabel?: string
    comparisonWindow?: string
    monitoringLevel?: string
    qualifyingCount?: string
    currentDate?: string
    currentDateTime?: string
  } = {}
): Promise<ExecutionResult> {
  const startMs = Date.now()
  const logs: StepLog[] = []
  const actionResults: ActionResult[] = []
  const now = new Date()
  const triggerPayload: TriggerPayload = {
    fileId: options.fileId,
    fileName: options.fileName,
    fileUrl: options.fileUrl,
    mimeType: options.mimeType,
    thumbnailUrl: options.thumbnailUrl,
    entityIds: options.entityIds,
    entityNames: options.entityNames,
    summary:           options.summary,
    metricFormatted:   options.metricFormatted,
    metricRaw:         options.metricRaw,
    previousValue:     options.previousValue,
    currentValue:      options.currentValue,
    actualChange:      options.actualChange,
    direction:         options.direction,
    directionPastTense:options.directionPastTense,
    threshold:         options.threshold,
    comparisonLabel:   options.comparisonLabel,
    comparisonWindow:  options.comparisonWindow,
    monitoringLevel:   options.monitoringLevel,
    qualifyingCount:   options.qualifyingCount,
    currentDate:       options.currentDate ?? now.toLocaleDateString("en-US"),
    currentDateTime:   options.currentDateTime ?? now.toLocaleString("en-US"),
  }

  try {
    const supabase = createAdminClient()

    addLog(logs, `Looking up automation ${automationId}`)
    const { data: automation, error } = await supabase
      .from("automations")
      .select("*")
      .eq("id", automationId)
      .eq("org_id", orgId)
      .single()

    if (error || !automation) {
      addLog(logs, `Automation not found: ${error?.message ?? "unknown"}`, "error")
      return { status: "failed", logs, triggerPayload, actionResults, durationMs: Date.now() - startMs }
    }

    addLog(logs, `Automation: "${automation.name}"`)
    if (options.isTest) addLog(logs, "=== TEST WITH SPECIFIC FILE MODE ===")

    if (options.fileId) {
      addLog(logs, `Using specific file ID: ${options.fileId}`)
      addLog(logs, `File: ${options.fileName ?? options.fileId}`)
      addLog(logs, `Type: ${options.mimeType ?? "unknown"}`)
    }

    // Prefer full steps array (includes trigger, delays, approvals) over legacy actions
    // automation.steps = full WorkflowStep[], automation.actions = legacy actions-only array
    const rawSteps: any[] = Array.isArray((automation as any).steps)
      ? (automation as any).steps.filter((s: any) => s.kind !== "trigger") // skip trigger step
      : Array.isArray(automation.actions) ? automation.actions : []
    const steps = rawSteps.map(s =>
      s.kind ? s : { kind: "action", actionConfig: s }
    )

    addLog(logs, `Steps: ${steps.length} configured`)
    return await execSteps(steps, options.startFromStep ?? 0, triggerPayload, automation, orgId, supabase, logs, actionResults, startMs, options)
  } catch (err: any) {
    addLog(logs, `Fatal error: ${err.message}`, "error")
    return { status: "failed", logs, triggerPayload, actionResults, durationMs: Date.now() - startMs }
  }
}

// ─── Core step executor (handles delay, approval, action) ─────────────────────

async function execSteps(
  steps: any[],
  startFrom: number,
  triggerPayload: TriggerPayload,
  automation: any,
  orgId: string,
  supabase: ReturnType<typeof createAdminClient>,
  logs: StepLog[],
  actionResults: ActionResult[],
  startMs: number,
  options: any
): Promise<ExecutionResult> {

  const META_ACTIONS = new Set([
    "pause_ad", "pause_campaign", "pause_adset",
    "enable_ad", "enable_campaign", "enable_adset",
    "duplicate_ad", "duplicate_adset", "duplicate_campaign",
    "increase_budget", "decrease_budget", "change_budget",
    "launch_ad",
  ])

  // Fetch Meta token if any action step needs it
  let fbToken: string | null = null
  const hasMetaActions = steps.slice(startFrom).some(s => s.kind === "action" && META_ACTIONS.has(s.actionConfig?.event))
  if (hasMetaActions) {
    const conn = await getFacebookConnection(orgId)
    fbToken = conn?.access_token ?? null
    if (!fbToken) addLog(logs, "No Meta connection — Meta actions will be skipped", "warn")
    else addLog(logs, "Meta connection found")
  }

  for (let i = startFrom; i < steps.length; i++) {
    const step = steps[i]
    const kind = step.kind ?? "action"

    // ── DELAY ────────────────────────────────────────────────────────────────
    if (kind === "delay") {
      const delay = step.delayConfig ?? { unit: "hours", value: 1 }
      const msMap: Record<string, number> = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 }
      if (!msMap[delay.unit]) {
        addLog(logs, `DELAY: invalid unit "${delay.unit}" — defaulting to 1 hour`, "warn")
        delay.unit = "hours"
      }
      if (!delay.value || delay.value <= 0) {
        addLog(logs, `DELAY: invalid value ${delay.value} — defaulting to 1`, "warn")
        delay.value = 1
      }
      const delayMs  = msMap[delay.unit] * delay.value
      const resumeAt = new Date(Date.now() + delayMs).toISOString()

      addLog(logs, `DELAY: ${delay.value} ${delay.unit} — pausing until ${resumeAt}`)

      const { data: exec } = await supabase.from("automation_executions").insert({
        org_id:          orgId,
        automation_id:   automation.id,
        automation_name: automation.name,
        status:          "pending",
        entities_affected: 0,
        api_calls:       actionResults.length,
        action_taken:    "delay",
        ad_account_id:   automation.ad_account_ids?.[0] ?? null,
        details: {
          isTest:         options.isTest ?? false,
          resumeFromStep: i + 1,
          resumeAt,
          triggerPayload,
          completedActionResults: actionResults,
          completedLogs:          logs,
          allSteps:               steps,
        },
      }).select("id").single()

      await supabase.from("automations")
        .update({ last_run_at: new Date().toISOString() })
        .eq("id", automation.id)

      return {
        status: "pending_delay",
        logs, triggerPayload, actionResults,
        durationMs: Date.now() - startMs,
        executionDbId: exec?.id,
        resumeAt,
      }
    }

    // ── APPROVAL ─────────────────────────────────────────────────────────────
    if (kind === "approval") {
      const approvalCfg = step.approvalConfig ?? { approvers: [], message: "", timeoutHours: 24 }
      addLog(logs, `APPROVAL: Requesting approval from ${approvalCfg.approvers?.join(", ") || "no approvers configured"}`)

      // Insert execution record in pending state
      const { data: exec } = await supabase.from("automation_executions").insert({
        org_id:          orgId,
        automation_id:   automation.id,
        automation_name: automation.name,
        status:          "pending",
        entities_affected: 0,
        api_calls:       actionResults.length,
        action_taken:    "approval",
        ad_account_id:   automation.ad_account_ids?.[0] ?? null,
        details: {
          isTest:         options.isTest ?? false,
          resumeFromStep: i + 1,
          triggerPayload,
          completedActionResults: actionResults,
          completedLogs:          logs,
          allSteps:               steps,
        },
      }).select("id").single()

      // Insert approval record
      const { data: approval } = await supabase.from("automation_approvals").insert({
        org_id:           orgId,
        automation_id:    automation.id,
        execution_id:     exec?.id,
        automation_name:  automation.name,
        status:           "pending",
        requested_action: steps.slice(i + 1).filter(s => s.kind === "action").map((s: any) => s.actionConfig?.event).join(", ") || "next steps",
        details: {
          approvers:      approvalCfg.approvers,
          message:        approvalCfg.message,
          timeoutHours:   approvalCfg.timeoutHours ?? 24,
          triggerPayload,
          executionId:    exec?.id,
        },
      }).select("id").single()

      // Send approval email
      if (approvalCfg.approvers?.length) {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? ""
        const approveUrl = `${appUrl}/api/automations/executions/${exec?.id}/approve?token=${approval?.id}`
        const rejectUrl  = `${appUrl}/api/automations/executions/${exec?.id}/reject?token=${approval?.id}`

        const emailBody = `
Automation "${automation.name}" requires your approval before continuing.

${approvalCfg.message ? `Message: ${approvalCfg.message}\n\n` : ""}Next steps: ${steps.slice(i + 1).filter((s: any) => s.kind === "action").map((s: any) => s.actionConfig?.event).join(", ") || "continue automation"}

✅ APPROVE: ${approveUrl}
❌ REJECT:  ${rejectUrl}

This approval will expire in ${approvalCfg.timeoutHours ?? 24} hours.
        `.trim()

        await sendEmail({
          to: approvalCfg.approvers,
          subject: `[AdLauncher] Approval required: ${automation.name}`,
          text: emailBody,
        }).then(r => { if (!r.ok) addLog(logs, `Failed to send approval email: ${r.error}`, "warn") })
          .catch(e => addLog(logs, `Failed to send approval email: ${e.message}`, "warn"))
      }

      await supabase.from("automations")
        .update({ last_run_at: new Date().toISOString() })
        .eq("id", automation.id)

      return {
        status: "pending_approval",
        logs, triggerPayload, actionResults,
        durationMs: Date.now() - startMs,
        executionDbId: exec?.id,
        approvalId: approval?.id,
      }
    }

    // ── ACTION ────────────────────────────────────────────────────────────────
    if (kind === "action" && step.actionConfig) {
      const action = step.actionConfig as ActionConfig & Record<string, any>
      addLog(logs, `--- Step ${i + 1}: ${action.event} ---`)
      let result: ActionResult

      const isTest = options.isTest ?? false

      if (action.event === "send_notification") {
        result = await execNotification(action, triggerPayload, automation.name, logs, orgId)
      } else if (META_ACTIONS.has(action.event)) {
        // Pass isTest so Meta mutations are skipped in test mode
        result = fbToken
          ? await execMetaAction(action, triggerPayload, fbToken, logs, isTest)
          : { event: action.event, status: "skipped", message: "No Meta connection" }
      } else if (["add_sheet_row", "update_sheet_cell", "update_sheet_row"].includes(action.event)) {
        result = await execSheetsAction(action, triggerPayload, logs, isTest)
      } else if (action.event === "upload_to_media_library") {
        result = await execMediaLibraryAction(action, triggerPayload, orgId, logs, isTest)
      } else if (action.event === "launch_ad") {
        if (!fbToken) {
          result = { event: action.event, status: "skipped", message: "No Meta connection" }
        } else {
          result = await execLaunchAdAction(action, triggerPayload, fbToken, orgId, logs, isTest)
        }
      } else {
        addLog(logs, `ERROR: Unsupported action type: ${action.event}`, "warn")
        result = { event: action.event, status: "failed", message: `Action "${action.event}" is not supported` }
      }

      actionResults.push(result)
      addLog(logs, `Result: ${result.status} — ${result.message}`)
    }
  }

  // All steps completed
  const overallStatus: "success" | "failed" | "skipped" =
    actionResults.length === 0 ? "skipped"
    : actionResults.some(r => r.status === "failed") ? "failed"
    : actionResults.every(r => r.status === "success") ? "success"
    : "skipped"

  const durationMs = Date.now() - startMs
  addLog(logs, `Completed in ${durationMs}ms — ${overallStatus}`)

  const { data: exec } = await supabase.from("automation_executions").insert({
    org_id:          orgId,
    automation_id:   automation.id,
    automation_name: automation.name,
    status:          overallStatus,
    entities_affected: actionResults.filter(r => r.status === "success").length,
    api_calls:       actionResults.length,
    action_taken:    steps.filter(s => s.kind === "action").map((s: any) => s.actionConfig?.event).join(", ") || "none",
    ad_account_id:   automation.ad_account_ids?.[0] ?? null,
    details: { isTest: options.isTest ?? false, triggerPayload, actionResults, logs },
  }).select("id").single()

  await supabase.from("automations")
    .update({ run_count: (automation.run_count ?? 0) + 1, last_run_at: new Date().toISOString() })
    .eq("id", automation.id)

  // ── Send bell notification if configured ─────────────────────────────────
  if (!options.isTest) {
    const notifCfg = (automation as any).notif_config
    const emails: string[] = notifCfg?.emails ?? []
    const shouldSend =
      (overallStatus === "success" && notifCfg?.on_success !== false) ||
      (overallStatus === "failed"  && notifCfg?.on_fail    !== false)

    if (emails.length && shouldSend) {
      const icon    = overallStatus === "success" ? "✅" : "❌"
      const subject = `${icon} Automation "${automation.name}" — ${overallStatus}`
      const text    = `Automation: ${automation.name}\nStatus: ${overallStatus}\nDuration: ${durationMs}ms\nSteps completed: ${actionResults.length}\n\nDetails:\n${actionResults.map(r => `• ${r.event}: ${r.status} — ${r.message}`).join("\n")}`
      await sendEmail({ to: emails, subject, text }).catch(() => {})
    }
  }

  return { status: overallStatus, logs, triggerPayload, actionResults, durationMs, executionDbId: exec?.id }
}

// ─── Resume execution (after delay or approval) ───────────────────────────────

export async function resumeAutomation(executionId: string): Promise<ExecutionResult> {
  const startMs = Date.now()
  const supabase = createAdminClient()

  const { data: exec, error } = await supabase
    .from("automation_executions")
    .select("*")
    .eq("id", executionId)
    .single()

  if (error || !exec) {
    return { status: "failed", logs: [{ ts: new Date().toISOString(), msg: "Execution not found", level: "error" }], triggerPayload: {}, actionResults: [], durationMs: 0 }
  }

  const details       = exec.details as any
  const resumeFrom    = details.resumeFromStep ?? 0
  const triggerPayload: TriggerPayload = details.triggerPayload ?? {}
  const actionResults: ActionResult[]  = details.completedActionResults ?? []
  const logs: StepLog[]                = details.completedLogs ?? []
  const steps: any[]                   = details.allSteps ?? []

  addLog(logs, `Resuming execution from step ${resumeFrom}`)

  const { data: automation } = await supabase
    .from("automations")
    .select("*")
    .eq("id", exec.automation_id)
    .eq("org_id", exec.org_id) // org isolation guard
    .single()

  if (!automation) {
    addLog(logs, `Automation not found or org mismatch for execution ${executionId}`, "error")
    return { status: "failed", logs, triggerPayload, actionResults, durationMs: Date.now() - startMs }
  }

  // Mark old execution as superseded
  await supabase.from("automation_executions")
    .update({ status: "skipped", details: { ...details, supersededAt: new Date().toISOString() } })
    .eq("id", executionId)

  return execSteps(steps, resumeFrom, triggerPayload, automation, exec.org_id, supabase, logs, actionResults, startMs, { isTest: details.isTest ?? false })
}
