-- =============================================================================
-- Staff can only record visits for themselves.
--
-- Visits count towards the salesperson's Rep Scorecard grade, so a staff user
-- must not be able to credit (or blame) a colleague. Staff may leave the
-- salesperson empty, or set it to their own linked employee record.
-- Managers and admins are unchanged.
-- =============================================================================

drop policy if exists interactions_insert on public.customer_interactions;
create policy interactions_insert on public.customer_interactions for insert to authenticated
  with check (
    public.can_write_branch(branch_id)
    and created_by = auth.uid()
    and (public.current_app_role() <> 'staff' or employee_id is null or employee_id = public.current_employee_id())
  );

drop policy if exists interactions_update on public.customer_interactions;
create policy interactions_update on public.customer_interactions for update to authenticated
  using (
    public.is_org_wide()
    or (public.current_app_role() = 'branch_manager' and branch_id = public.current_branch_id())
    or (public.current_app_role() = 'staff' and created_by = auth.uid())
  )
  with check (
    public.can_write_branch(branch_id)
    and (public.current_app_role() <> 'staff' or employee_id is null or employee_id = public.current_employee_id())
  );
