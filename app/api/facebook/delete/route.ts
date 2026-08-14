import { NextRequest, NextResponse } from "next/server"
import { getAuthContext, getConnectionForAdAccount, isManual, MissingViaError, requireRole } from "@/lib/auth"
import { getResourceAccountId } from "@/lib/facebook"
import { adAccountBelongsToOrg } from "@/app/api/facebook/_utils"
import { secureMetaFetch } from "@/lib/meta-secure-fetch"
import { invalidateMetaReadCacheAfterWrite } from "../_db-cache"

const GRAPH = "https://graph.facebook.com/v25.0"

// POST /api/facebook/delete
// Body: { ids: string[], adAccountId?: string }
// Deletes campaigns, ad sets, or ads — Meta API uses DELETE /{id} for all.
export async function POST(request: NextRequest) {
  try {
    const ctx = await getAuthContext()
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    // Deletion is destructive and irreversible on Meta — same role bar as the write routes.
    const denied = requireRole(ctx)
    if (denied) return denied

    const { ids, adAccountId } = await request.json()
    if (!ids?.length) return NextResponse.json({ error: "ids is required" }, { status: 400 })

    // Via MECE: mutation = WRITE → via launch của account → OAuth → block (VIA-MASTER.md)
    let connection
    try {
      connection = await getConnectionForAdAccount(ctx.orgId, adAccountId, "write")
    } catch (err) {
      if (err instanceof MissingViaError) {
        return NextResponse.json({ error: err.message, code: "MISSING_LAUNCH_VIA" }, { status: 400 })
      }
      throw err
    }
    if (!connection) return NextResponse.json({ error: "No Facebook connection" }, { status: 400 })

    const token = connection.access_token
    const manual = isManual(connection)
    const results: { id: string; success: boolean; error?: string }[] = []

    for (const id of ids as string[]) {
      try {
        const resourceAccountId = await getResourceAccountId(id, token, { isManual: manual })
        if (!resourceAccountId) {
          results.push({ id, success: false, error: "Could not verify resource ownership" })
          continue
        }
        const belongs = await adAccountBelongsToOrg(ctx.orgId, "act_" + resourceAccountId, token)
        if (!belongs) {
          results.push({ id, success: false, error: "Access denied" })
          continue
        }

        const res = await secureMetaFetch(`${GRAPH}/${id}?access_token=${token}`, {
          method: "DELETE",
        }, { skipProof: manual })
        const data = await res.json()
        if (!res.ok) {
          results.push({ id, success: false, error: data.error?.message || "Failed" })
        } else {
          results.push({ id, success: true })
        }
      } catch (err: any) {
        results.push({ id, success: false, error: err.message || "Failed" })
      }
    }

    const failed = results.filter(r => !r.success)
    if (results.some(result => result.success) && adAccountId) {
      await invalidateMetaReadCacheAfterWrite({
        orgId: ctx.orgId,
        adAccountId,
        objectIds: results.filter(result => result.success).map(result => result.id),
      })
    }
    return NextResponse.json({
      success: failed.length === 0,
      results,
      deleted: results.filter(r => r.success).length,
      failed: failed.length,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Server error" }, { status: 500 })
  }
}
