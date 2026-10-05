# AGENT_LOG.md — Conversation & Verification Audit Log

## 1. Key Prompts in This Trajectory

1. **Initial Codebase Reverse-Engineering Prompt**:
   - Requested tech stack, local run instructions, folder map, odd files, and fault identification under strict read-only constraints.
2. **Product Architecture & Conceptualization**:
   - Requested explanation of Flexprice to a first-year student, user roles, core features, and architectural Mermaid diagrams.
3. **Data Model & Entry Points Audit**:
   - Enumerated all backend REST endpoints (293 routes), entity models, relational mappings, and ER diagrams.
4. **End-to-End Feature Tracing & UI Reality Verification**:
   - Requested 1–3 screenshots of the running app, main user journey, and separation of routed screens from mockups.
   - Identified that the repository is 100% headless Go backend with 0 frontend screens, with UI hosted externally in `flexprice-front`.
5. **Senior Code Reviewer Gap Analysis**:
   - Requested a prioritized gap table across security, correctness, data integrity, UX, and docs drift.
6. **Strict Line-by-Line Claim Verification & Correction Prompt**:
   - Prompted to re-read every line cited in the conversation, tag with `[Confirmed]`, `[Likely]`, or `[Guess]`, and document all corrections.
7. **Documentation Rebuild Package Prompt**:
   - Requested creation of `OBSERVATIONS.md`, `PRD.md`, `ARCHITECTURE.md`, `DATA_MODEL.md`, `API.md`, `GAPS.md`, and `AGENT_LOG.md`.

---

## 2. Rigorous Corrections & Resolution Log

Below is the exhaustive log of every claim, line number, or file path that was corrected or dropped during line-by-line verification:

### Correction 1: Welcome Email Dispatch on Tenant Signup
- **Original Claim**: Stated that `POST /v1/auth/signup` renders and sends `welcome-email.html` via `internal/service/email.go:68`.
- **Finding**:
  1. The file `internal/service/email.go` does not exist. The actual file is `internal/email/service.go`.
  2. In `internal/email/service.go:14`, the HTML template is embedded as a string constant.
  3. However, `email.NewEmail` is never invoked, instantiated, or called anywhere in `internal/ee/service/auth.go` or `cmd/server/main.go`.
- **Action**: **DROPPED**. The email template exists, but email delivery is un-wired dead code in the current codebase.

---

### Correction 2: Invoice PDF Service File Path
- **Original Claim**: Cited `internal/service/invoice_pdf.go:183` as the PDF generator.
- **Finding**: The file `internal/service/invoice_pdf.go` does not exist.
- **Action**: **CHANGED** to `internal/ee/service/invoice.go:3234` (where `GetInvoicePDF` is implemented) and `internal/pdf/service.go:52` (which invokes Typst compiler `CompileTemplate`).

---

### Correction 3: External Frontend Repository Citation
- **Original Claim**: Cited `README.md:94–96` as explicitly naming the `flexprice-front` repository.
- **Finding**: `README.md:94` only mentions "accessible via Flexprice’s APIs and dashboard". The exact external Git repository name and URL are defined in `internal/ee/infrastructure/helm/flexprice/values.yaml:609` (`https://github.com/flexprice/flexprice-front.git`), `AI_NATIVE_IMPLEMENTATION_PROMPT.md:14`, and `docs/design/credit-grants-in-addons.md:45`.
- **Action**: **CHANGED** citation from `README.md` to `internal/ee/infrastructure/helm/flexprice/values.yaml:609`.

---

### Correction 4: Router Route Line Alignments (`internal/api/router.go`)
During line-by-line re-reading of `internal/api/router.go`, several route line citations were slightly offset and have been corrected to their exact code locations:

| Endpoint | Previous Citation | Exact Confirmed Line | Code Verification |
| :--- | :--- | :--- | :--- |
| `POST /v1/auth/signup` | Line 153 | **Line 151** | `v1Public.POST("/auth/signup", handlers.Auth.SignUp)` |
| `POST /v1/secrets/api/keys` | Line 763 | **Line 569** | `apiKeys.POST("", write(types.EntitySecret, ...), handlers.Secret.CreateAPIKey)` |
| `POST /v1/meters` | Line 277 | **Line 243** | `meters.POST("", write(types.EntityMeter, ...), handlers.Meter.CreateMeter)` |
| `POST /v1/prices` | Line 214 | **Line 253** | `price.POST("", write(types.EntityPrice, ...), handlers.Price.CreatePrice)` |
| `POST /v1/plans` | Line 240 | **Line 314** | `plan.POST("", write(types.EntityPlan, ...), handlers.Plan.CreatePlan)` |
| `POST /v1/customers` | Line 351 | **Line 279** | `customer.POST("", write(types.EntityCustomer, ...), handlers.Customer.CreateCustomer)` |
| `POST /v1/subscriptions` | Line 387 | **Line 354** | `subscription.POST("", write(types.EntitySubscription, ...), handlers.Subscription.CreateSubscription)` |
| `POST /v1/events` | Lines 305–307 | **Lines 209–210**| `events.POST("", ingestBodyLimit, write(types.EntityEvent, ...), handlers.Events.IngestEvent)` |
| `POST /v1/invoices/:id/compute` | Line 432 | **Line 441** | `invoices.POST("/:id/compute", write(types.EntityInvoice, ...), handlers.Invoice.ComputeInvoice)` |
| `POST /v1/invoices/:id/finalize` | Line 436 | **Line 440** | `invoices.POST("/:id/finalize", write(types.EntityInvoice, ...), handlers.Invoice.FinalizeInvoice)` |
| `POST /v1/invoices/:id/payment/attempt` | Line 442 | **Line 446** | `invoices.POST("/:id/payment/attempt", write(types.EntityInvoice, ...), handlers.Invoice.AttemptPayment)` |

---

### Correction 5: API Handler Method Line Alignments (`internal/api/v1/`)

| Handler Method | Previous Citation | Exact Confirmed Line | Code Verification |
| :--- | :--- | :--- | :--- |
| `CreateAPIKey` | `secret.go:35` | **`internal/api/v1/secret.go:80`** | `func (h *SecretHandler) CreateAPIKey(c *gin.Context)` |
| `CreateMeter` | `meter.go:30` | **`internal/api/v1/meter.go:24`** | `func (h *MeterHandler) CreateMeter(c *gin.Context)` |
| `CreatePrice` | `price.go:30` | **`internal/api/v1/price.go:39`** | `func (h *PriceHandler) CreatePrice(c *gin.Context)` |
| `CreatePlan` | `plan.go:30` | **`internal/api/v1/plan.go:61`** | `func (h *PlanHandler) CreatePlan(c *gin.Context)` |
| `CreateCustomer` | `customer.go:30` | **`internal/api/v1/customer.go:52`** | `func (h *CustomerHandler) CreateCustomer(c *gin.Context)` |
| `CreateSubscription`| `subscription.go:30`| **`internal/api/v1/subscription.go:38`**| `func (h *SubscriptionHandler) CreateSubscription(c *gin.Context)` |
| `IngestEvent` | `events.go:40` | **`internal/api/v1/events.go:54`** | `func (h *EventsHandler) IngestEvent(c *gin.Context)` |
| `ComputeInvoice` | `invoice.go:190` | **`internal/api/v1/invoice.go:170`** | `func (h *InvoiceHandler) ComputeInvoice(c *gin.Context)` |
| `FinalizeInvoice` | `invoice.go:340` | **`internal/api/v1/invoice.go:154`** | `func (h *InvoiceHandler) FinalizeInvoice(c *gin.Context)` |
| `AttemptPayment` | `invoice.go:731` | **`internal/api/v1/invoice.go:572`** | `func (h *InvoiceHandler) AttemptPayment(c *gin.Context)` |
