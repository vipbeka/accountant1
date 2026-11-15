-- Employee CV (PDF) storage.
--
-- Before this migration CVs were stored as base64 data-URLs *inside* the
-- single `settings.hr_store_v1` JSON blob. That capped files at ~700 KB,
-- bloated every HR save (the whole blob is rewritten each time) and broke
-- in-browser preview of larger PDFs. CVs now live in a private Storage bucket;
-- the HR blob only keeps a small reference (cv_path / cv_name / cv_size).
--
-- file_size_limit = NULL  -> no bucket-level cap. The effective ceiling is the
-- project's *global* upload limit (Dashboard -> Storage -> Settings), which
-- cannot be set from SQL. Raise it there if you need files above it.
-- allowed_mime_types      -> server-side MIME enforcement (PDF only).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('employee-cvs', 'employee-cvs', false, null, array['application/pdf'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Any signed-in user may read CVs (the HR page is already behind auth);
-- only roles allowed to write (public.can_write()) may upload / replace / delete.
drop policy if exists "employee_cvs_read"   on storage.objects;
drop policy if exists "employee_cvs_insert" on storage.objects;
drop policy if exists "employee_cvs_update" on storage.objects;
drop policy if exists "employee_cvs_delete" on storage.objects;

create policy "employee_cvs_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'employee-cvs');

create policy "employee_cvs_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'employee-cvs' and public.can_write());

create policy "employee_cvs_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'employee-cvs' and public.can_write())
  with check (bucket_id = 'employee-cvs' and public.can_write());

create policy "employee_cvs_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'employee-cvs' and public.can_write());
