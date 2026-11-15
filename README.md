# accountant

## Deployment notes

### Employee CV storage (required once)
Employee CVs (PDF) are stored in the private Supabase Storage bucket `employee-cvs`
instead of inside the `hr_store_v1` settings blob. Create it by running
`supabase/migrations/20261115000000_employee_cvs_bucket.sql` (SQL editor or `supabase db push`).

- The bucket has **no size limit** (`file_size_limit = NULL`) and accepts `application/pdf` only.
- The effective ceiling is the project's *global* upload limit: Dashboard → Storage → Settings.
  Raise it there for very large files (plan-dependent).
- Files > 6 MB are uploaded with the TUS resumable protocol (6 MB chunks, automatic retry/resume).
- Until the migration is applied, PDFs ≤ 700 KB fall back to the old inline storage; larger ones show an error naming the migration.
- Existing inline PDF CVs are moved to the bucket automatically the first time an admin opens the HR page.

### Salary statement print rules
- Salary records whose source salary voucher was deleted or un-posted are removed from the HR payroll history automatically.
- A salary record appears in the printed / exported employee statement only 24 hours after its `created_at`.

### Form drafts (auto-save)
Every data-entry form and modal auto-saves to `localStorage` through one engine:
`public/assets/js/form-draft.js` (`Drafts.register({...})` → `.open()` after the form is filled, `.done()` after a successful save).

- Key per form and record: `draft_<module>_<form>_<create|edit>_<recordId|new>`, stored as `accsys:<userId>:<key>`.
- Saved (debounced 400 ms) on every input, change, and row add/remove; restored on reopen, refresh, or tab close; a banner and a "🧹 مسح النموذج" Reset button appear.
- Cleared only on successful save or Reset. Validation or network failures keep the draft. Files are never stored (only their name), and passwords/security answers are never stored.
- Corrupted, old-version, or >30-day drafts are discarded automatically; a full browser storage never breaks the form.

Covered: accounts (create/edit), budget allocation, expenses, invoices + line items, parties, receipt/payment/salary vouchers,
journal entry (new/edit/copy) + lines, journal import options, company & tax settings + signatures, regions, add user,
security question, my profile, HR employee/job/attendance/leaves/advances/payroll posting/end-of-service.
Intentionally excluded: login, forgot password, all password-change fields, the destructive wipe-entries modal, the read-only SQL modal,
file-only import pickers, and report filter bars.
