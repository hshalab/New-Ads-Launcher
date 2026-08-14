import { NextRequest, NextResponse } from "next/server"
import { getAuthContext } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getAuthContext()
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { id } = await params
    const db = process.env.SUPABASE_SERVICE_ROLE_KEY
      ? createAdminClient()
      : await createAdminClient()

    const { data: board, error: boardError } = await db
      .from("asset_boards")
      .select("id, name, description")
      .eq("id", id)
      .eq("org_id", ctx.orgId)
      .single()

    if (boardError || !board) {
      return NextResponse.json({ error: "Board not found" }, { status: 404 })
    }

    const boardAssets: any[] = []
    const pageSize = 1000
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await db
        .from("board_assets")
        .select("creative_id, added_at, creatives!inner(*)")
        .eq("board_id", id)
        .eq("creatives.org_id", ctx.orgId)
        .order("added_at", { ascending: false })
        .range(from, from + pageSize - 1)

      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      boardAssets.push(...(data || []))
      if (!data || data.length < pageSize) break
    }

    const creatives = (boardAssets || []).flatMap((boardAsset) => {
      const nestedCreative = boardAsset.creatives
      if (Array.isArray(nestedCreative)) return nestedCreative
      return nestedCreative ? [nestedCreative] : []
    })

    return NextResponse.json({ board, creatives })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load board" },
      { status: 500 }
    )
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getAuthContext()
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { id } = await params
    const body = await request.json()
    const db = process.env.SUPABASE_SERVICE_ROLE_KEY
      ? createAdminClient()
      : await createAdminClient()

    const { data, error } = await db
      .from("asset_boards")
      .update({ name: body.name, description: body.description, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("org_id", ctx.orgId)
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ board: data })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update board" },
      { status: 500 }
    )
  }
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getAuthContext()
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { id } = await params
    const db = process.env.SUPABASE_SERVICE_ROLE_KEY
      ? createAdminClient()
      : await createAdminClient()

    const { error } = await db
      .from("asset_boards")
      .delete()
      .eq("id", id)
      .eq("org_id", ctx.orgId)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to delete board" },
      { status: 500 }
    )
  }
}
