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

### Form drafts
The Add/Edit Employee, Job and new Journal Entry forms auto-save drafts to `localStorage`
(per user, max 14 days). Drafts are cleared on successful save or via the "مسح النموذج" button. File contents are never stored, only the file name.
