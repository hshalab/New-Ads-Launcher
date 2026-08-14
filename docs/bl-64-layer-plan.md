# BL-64 — Editor là bề mặt tạo campaign duy nhất · Layer plan

Ngày: 2026-08-13 · Scope khoá: flow 1–3. Flow 4 (duplicate account A→B) tách BL riêng.
Nguồn: `.scratch/create-campaign-editor-merge/bl-64-spec.md`, `architecture/create-campaign-e2e-flow.canvas`,
`specs/create-campaign-rebuild/PRD.md`. Đây là plan, không phải code.

## One-pager §1–7

1. **Summary.** Thay Create Campaign wizard bằng một editor duy nhất cho create, draft, publish và
   duplicate cùng ad account; Meta objects luôn PAUSED cho đến activation riêng.
2. **Problem & evidence.** Hai component tree + hai state model (~6,510 dòng) đã phân kỳ field/rule;
   buyer tạo xong phải tìm lại object. Product owner chốt 13/08/2026; BL-64 là intake canonical.
3. **JTBD + role.** Khi cần lên hoặc nhân bản campaign, Media Buyer muốn tạo/sửa đủ ba cấp tại một
   chỗ để giảm create→edit round trip. Quyền mutate thực tế: `admin` / `editor` / `launcher`.
4. **Goal & metric.** Tăng campaign publish-ready/tuần từ editor; guardrail: 0 Meta object PAUSED do
   session tạo mà không có batch row. Chưa instrument (BL-12), kiểm tay sau 7 ngày.
5. **Solution sketch.** Shell campaign thật PAUSED → Save Draft partial materialize child + batch audit
   → Publish gate + finalize batch, vẫn PAUSED → activation riêng. Discard reverse-delete session IDs.
6. **MoSCoW.** Must: flow 1–3, partial Save Draft, blocked Publish, safe Discard, forced-PAUSED duplicate.
   Should: PPE/CBO/ABO, zero-child budget toggle. Could: targeted highlight. Won't: §7.
7. **Non-goals.** Cross-device drafts, cross-account duplicate, analytics, ROAS picker, feature flag,
   schema/env changes. Cross-account duplicate đề xuất **BL-65** vì BL-64 là ID cao nhất hiện tại;
   chỉ đăng ký ID khi cập nhật canonical `product/backlog.md` qua workflow docs.

## L0 — Cơ hội

**JTBD.** Khi Media Buyer cần lên campaign mới hoặc nhân bản một campaign đang chạy, họ muốn tạo và
sửa đủ 3 cấp trong một bề mặt duy nhất, để không rơi khỏi màn tạo rồi phải tự tìm lại object vừa tạo.

Provenance: product owner chốt trực tiếp 13/08/2026. Persona: Media Buyer. Role mutate trong app là
`admin` / `editor` / `launcher` (`lib/auth.ts` `LAUNCH_ROLES`), không phải `media_buyer` — plan dùng
đúng tên role của app.

| | |
|---|---|
| North Star (input) | Campaign publish-ready/tuần từ editor |
| Guardrail | Số Meta object PAUSED do session tạo mà không có batch row = 0 |
| Đo được? | Không — BL-12. Kiểm tay với owner sau 7 ngày |

**RICE + CoD.** Reach = số campaign tạo/tháng. Con số đó **chưa đo được** (BL-12), nên plan dùng
proxy R = 1 cho mọi hạng mục — RICE ở đây chỉ dùng để xếp thứ tự nội bộ, không so được với backlog
đã có P&L. Effort tính bằng person-week.

| Hạng mục | R / I / C / E | RICE | Ghi chú |
|---|---|---|---|
| Save Draft + batch audit (slice 1–3) | 1 / 3 / 0.7 / 1.5 | 1.4 | chặn mọi thứ khác |
| Discard đảo chiều (slice 4) | 1 / 2 / 0.8 / 0.5 | 3.2 | bắt buộc đi cùng slice 2 |
| Duplicate hardening (slice 5) | 1 / 3 / 0.7 / 0.5 | 4.2 | có lỗ hổng bảo mật → CoD đẩy lên |
| PPE/CBO/ABO + budget-mode lock (slice 6) | 1 / 2 / 0.8 / 1.0 | 1.6 | |
| Gỡ create wizard cũ (slice 7) | 1 / 1 / 0.6 / 1.0 | 0.6 | xoá đường lui |

RICE thô sẽ xếp 5 → 4 → 6 → 1–3 → 7. Sai, vì slice 4 và 5 không có gì để xoá/để bảo vệ khi chưa có
đường materialize; dependency ghi đè.

**Thứ tự sau hiệu chỉnh dependency + CoD:** 1 → 2 → 3 → 4 → 5 → 6 → 7. Slice 5 mang lỗ hổng bảo mật
nên được kéo lên ngay sau khi vòng draft/publish/discard đóng, trước phần coverage.

**MoSCoW — Won't this time.** Draft bền vững cross-device (BL-59), đo adoption (BL-12), lưu publish
failure (TD-43), duplicate cross-account (BL mới), ROAS goal trong UI (BL-56), feature flag (TD-06).

## Checklist gate L0–L8

| Layer | Câu hỏi chặn | Bỏ qua sẽ hỏng gì | Kết luận |
|---|---|---|---|
| L0 | Ai gặp vấn đề, KPI nào đổi, why now? | merge hai UI không tạo outcome | Media Buyer; time-to-launch; revenue path đang đứt |
| L1 | Entity, cardinality, discriminator, tenant, migration? | budget nằm sai cấp; draft/account leak | session ledger; CBO/ABO; org+account; không migration |
| L2 | Boundary validate ở đâu; env/DB types có drift? | client gửi id/payload sai tới Meta | validation thuần server; không env/table mới |
| L3 | Ai được mutate; resource có thật thuộc org/account? | role read-only xoá/copy; cross-account write | `requireRole` + resource ownership cho mọi id |
| L4 | Route/module nào sở hữu materialize, publish, batch? | mode flag làm guard bị bỏ qua; batch trùng/mồ côi | route materialize riêng; module batch sâu; publish edit-only |
| L5 | Loading/empty/error/unauthorized/partial state hiển thị thế nào? | buyer tưởng local draft chưa chạm Meta; xoá nhầm | trạng thái theo node; hai Discard khác chữ; gate có lý do |
| L6 | Seam nào có test; lỗi đi đâu? | chỉ happy path hoạt động; lỗi phát hiện bởi buyer | ledger + eligibility + route contract; smoke Meta thủ công |
| L7 | Audit và exit path của mỗi Meta object? | không truy được ai tạo; object PAUSED mồ côi | batch sinh từ ad đầu tiên; reverse Discard; activation riêng |
| L8 | Build/deploy gate, types/env/i18n? | push hỏng chạy thẳng production | Docker Mac mini; blackout; ghi P0 CI/env/types; không mở i18n |

## L1 — Domain

| Câu hỏi chặn | Trả lời |
|---|---|
| Entity mới? | Không. Chỉ thêm **session ledger** phía client: thứ tự tạo, `localNodeId → metaId`, `batchId` |
| Discriminator | `budgetMode: CBO \| ABO` — quyết định cấp nào giữ budget/strategy. `bid_amount`/`bid_constraints` luôn ở ad set |
| Tenancy | `org_id` + ad account, xác thực server-side từ chính Meta resource, không tin client |
| Migration | **Không.** `launch_batches` + `launch_drafts` đã tồn tại; scope này chỉ ghi `launch_batches` |

**Từ vựng chốt.** *Materialize* = tạo object thật PAUSED trên Meta khi Save Draft. *Publish* = đóng
batch, vẫn PAUSED. *Activate* = hành động riêng, dùng `POST /api/facebook/toggle-status`.

**Catch của L1.** `launch_batches.status` không phải trạng thái tự do: `lib/tracking/summary.ts`,
`app/api/tracking/probation/route.ts`, `app/api/tracking/route.ts` coi mọi giá trị khác `success` là
lỗi cần review, và Tracking hiển thị chuỗi thô. Vì vậy **không thêm giá trị status mới** cho trạng
thái "đã materialize, chưa publish" — sẽ làm bẩn báo cáo team. Dùng `partial` cho batch chưa publish
(đúng nghĩa "chưa trọn"), và `success` khi Publish đóng batch không lỗi.

**Trade-off đã biết, chấp nhận có ý thức.** Một batch đang ở `partial` sẽ được Tracking đếm vào
`nonSuccess` / "needs review" trong lúc buyer còn đang soạn. Đây là nhiễu báo cáo tạm thời, đổi lấy
việc không có ad thật nào tồn tại ngoài audit. Lựa chọn còn lại — thêm giá trị status mới — sẽ hiện
chuỗi lạ trong bảng Tracking và vẫn bị `!== "success"` gom vào nhóm lỗi, tức không rẻ hơn mà lại đổi
vốn từ chung. Nếu nhiễu này thành vấn đề thật, cách sửa đúng là cho `lib/tracking/summary.ts` phân
biệt batch chưa publish — đó là ticket riêng, không nhét vào BL-64.

## L2 — Validation & types

- Repo **không có zod, không có `@t3-oss/env-nextjs`, không có script `db:types`**. Không thêm
  dependency cho scope này — validate bằng hàm thuần trong `lib/`, cùng kiểu các route hiện có.
- Không có env var mới.
- Không có bảng mới ⇒ không phát sinh drift type.
- Gate còn thiếu ở repo là **finding P0 chung**, không phải blocker của BL-64: ghi vào L8.

## L3 — Auth / RBAC / tenancy

| Route | Hiện trạng | Bắt buộc |
|---|---|---|
| `create-campaign-shell` | đủ `requireRole` + ownership + Via LAUNCH | giữ nguyên |
| `toggle-status` | đủ guard, dùng làm activation | giữ nguyên |
| `campaigns/[id]/duplicate` | **thiếu `requireRole`, thiếu ownership, raw `fetch`, cho phép ACTIVE** | thêm role + `getResourceAccountId` + `adAccountBelongsToOrg` + `secureMetaFetch({skipProof: manual})`, ép PAUSED, bỏ log full response |
| `facebook/delete` | có ownership, **thiếu `requireRole`** | thêm role; nhận danh sách theo thứ tự đảo |
| route materialize mới | — | full gate như `create-campaign-shell`, xác thực **mọi** id từ Meta, không tin `adAccountId` client |
| `campaigns/[id]` DELETE | dùng OAuth legacy, không check account | **không dùng** cho Discard |

Ledger client là **bộ chọn ứng viên, không phải ranh giới phân quyền**.

## L4 — API & domain seams

Ba module `lib/` thuần + một route mới. Không thêm mode flag vào `workspace-publish`.

| Seam | Sở hữu |
|---|---|
| `lib/session-created-ledger.ts` | thứ tự tạo, remap id, thứ tự xoá đảo chiều |
| `lib/publish-eligibility.ts` | đủ 3 cấp, mọi node có Meta id, creative ready (dùng `lib/creative-readiness.ts`), không còn lỗi |
| `lib/launch-batch.ts` | insert lần đầu + finalize; nơi duy nhất biết vốn từ `status` |
| `POST /api/ads-manager/workspace-materialize` | tạo/update child PAUSED, trả kết quả từng node |

`workspace-publish` giữ nguyên edit-only. Discard tái dùng `POST /api/facebook/delete`.

**Catch của L4.** Hợp đồng khoá ban đầu nói Save Draft tạo ad còn Publish mới ghi `launch_batches`.
Hai điều đó không thể cùng đúng: `CONTEXT.md` yêu cầu mọi đường tạo ads phải ghi batch. Đóng tab
giữa chừng sẽ để lại ad thật PAUSED **không có dòng audit nào** — vô hình với Launch History, Tracking,
team stats. **Sửa:** batch được insert ở lần materialize ad đầu tiên (status `partial`), giữ `batchId`
trong ledger, mỗi Save Draft sau update chính dòng đó, Publish finalize dòng đó. Không bao giờ insert
dòng thứ hai.

## L5 — UI / UX

- Bốn trạng thái mỗi node: local-only, đã materialize, lỗi (kèm lý do), đã publish.
- **Hai nút Discard phải khác chữ:** "Bỏ thay đổi cục bộ" vs "Xoá nháp trên Meta". Câu review hiện tại
  của `PerformancePopup` nói *không có gì lên Meta trước khi Publish* — đã sai, phải sửa cùng slice 2.
- Publish disabled kèm lý do theo từng cấp.
- Toggle CBO/ABO chỉ bật khi campaign có 0 ad set; `structuralReplacement` phải tính thêm budget mode.
- Editor còn "Create ad · soon" — mở editor ngay sau shell mà chưa có slice 2 sẽ kẹt buyer.

## L6 — Test & observability

Không CI, không observability (TD-12, TD-06). Test theo kiểu hiện có: Node `.mjs` + `assert`.

Đỏ trước, theo lát:

1. `tests/session-created-ledger.test.mjs` — thứ tự tạo, remap, thứ tự xoá đảo chiều, node lỗi vẫn ở lại.
2. `tests/publish-eligibility.test.mjs` — bảng đúng/sai: thiếu cấp, thiếu Meta id, creative chưa ready, còn lỗi.
3. `tests/workspace-materialize-contract.test.mjs` — guard đủ, batch insert đúng một lần, PAUSED.

Thiếu script chạy test Node ⇒ thêm `"test:contract"` gom `tests/*.test.mjs` (một dòng package.json).

Smoke tay bắt buộc trước deploy: Meta hiển thị object PAUSED · Launch History có batch · Discard xoá
sạch · duplicate cross-account bị 403.

## L7 — Security & lifecycle

- Mọi write đi Via LAUNCH; đọc đi Via NON-LAUNCH; token manual bỏ `appsecret_proof`.
- Mọi write xong gọi `invalidateMetaReadCacheAfterWrite`.
- Audit khả dụng duy nhất là `launch_batches` ⇒ đó là lý do batch phải sinh sớm (L4).
- Publish không kích hoạt gì; activation là `toggle-status` riêng.
- Discard chỉ xoá id do phiên này tạo, theo thứ tự ad → ad set → campaign; thất bại giữ lại trong
  ledger để xoá lại.

## L8 — Delivery

- Deploy Docker trên Mac mini, tránh 13:00–15:00 UTC+7.
- Không feature flag ⇒ mỗi lát ship cho tất cả; slice 7 mới xoá đường lui.
- **Finding P0 mức repo (ngoài BL-64):** không có env module kiểu `createEnv`, không có `db:types`,
  không có CI gate. Ghi nhận, không sửa trong scope này.
- i18n: UI hiện dùng chuỗi trộn; không mở rộng trong scope này.

## Tracer slices

| # | Lát | Quan sát được ngoài UI |
|---|---|---|
| 1 | Ledger + eligibility (thuần, có test) | test đỏ→xanh |
| 2 | `workspace-materialize`: một ad set + một ad ABO, PAUSED, **batch insert lần đầu** | Meta có object; `launch_batches` có dòng đúng org |
| 3 | Gate Publish + finalize batch, giữ PAUSED | Publish bị chặn kèm lý do; batch chuyển `success` |
| 4 | Discard đảo chiều qua `facebook/delete` + `requireRole` | object biến mất trên Meta; lỗi còn lại vẫn xoá lại được |
| 5 | Duplicate hardening + refetch hierarchy | id nguồn khác org → 403; bản sao PAUSED |
| 6 | PPE/CBO/ABO + khoá budget mode khi có child | server từ chối chuyển đổi |
| 7 | Gỡ create wizard cũ | chỉ sau khi 1–6 smoke sạch |

Giao lát 1 cho `tdd`; lát 2 trở đi cho `adlaunch-eng`.

## Gate Supabase

1. **Env module:** repo không có `lib/env.ts` kiểu `createEnv`. BL-64 không thêm biến mới ⇒ không
   chặn scope, nhưng là nợ P0 đã ghi.
2. **`db:types`:** không có script sinh type. BL-64 **không đổi schema** ⇒ không có drift mới.
