-- =============================================================================
-- Reference data: survey templates, default SMS templates, system settings.
-- No business / customer data is seeded.
-- =============================================================================

grant execute on function public.cx_responses(date, date, uuid, uuid, public.survey_type, text) to authenticated;
grant execute on function public.cx_invitations(date, date, uuid, uuid, public.survey_type, text) to authenticated;
grant execute on function public.analytics_overview(date, date, uuid, uuid, public.survey_type, text) to authenticated;
grant execute on function public.analytics_nps_trend(date, date, uuid, uuid, public.survey_type, text, text) to authenticated;
grant execute on function public.analytics_rating_distribution(date, date, uuid, uuid, public.survey_type, text) to authenticated;
grant execute on function public.analytics_nps_distribution(date, date, uuid, uuid, public.survey_type, text) to authenticated;
grant execute on function public.analytics_non_purchase_reasons(date, date, uuid, uuid, text) to authenticated;
grant execute on function public.analytics_response_rate_trend(date, date, uuid, uuid, public.survey_type, text) to authenticated;
grant execute on function public.analytics_invitation_status(date, date, uuid, uuid, public.survey_type, text) to authenticated;
grant execute on function public.analytics_branch_performance(date, date, public.survey_type, text) to authenticated;
grant execute on function public.analytics_employee_performance(date, date, uuid, public.survey_type, text) to authenticated;

insert into public.survey_templates (survey_type, version, title, questions) values
('purchased', 1, 'Purchased customer survey', '[
  {"order":1,"key":"nps_score","type":"nps","required":true,
   "text":"How likely are you to recommend iDealz Lanka to your friends or family based on your purchasing experience?"},
  {"order":2,"key":"product_satisfaction","type":"emoji","required":true,
   "text":"How satisfied are you with the product you purchased from iDealz Lanka?"},
  {"order":3,"key":"staff_service_rating","type":"stars","required":true,
   "text":"How would you rate the service and assistance provided by our staff?"},
  {"order":4,"key":"overall_experience_rating","type":"emoji","required":true,
   "text":"How would you rate your overall purchasing experience at iDealz Lanka?"},
  {"order":5,"key":"additional_feedback","type":"text","required":false,
   "text":"Is there anything we could improve to make your experience better?"}
]'::jsonb),
('non_purchased', 1, 'Non-purchased customer survey', '[
  {"order":1,"key":"nps_score","type":"nps","required":true,
   "text":"Based on your interaction with iDealz Lanka, how likely are you to recommend us to your friends or family?"},
  {"order":2,"key":"non_purchase_reason","type":"single_select","required":true,
   "text":"What was the main reason you decided not to purchase from iDealz Lanka?"},
  {"order":3,"key":"staff_service_rating","type":"stars","required":true,
   "text":"How would you rate the assistance and service provided by our staff?"},
  {"order":4,"key":"product_pricing_satisfaction","type":"emoji","required":true,
   "text":"How satisfied were you with our product availability, pricing and available offers?"},
  {"order":5,"key":"additional_feedback","type":"text","required":false,
   "text":"What could iDealz Lanka do to improve your experience and encourage you to purchase from us in the future?"}
]'::jsonb);

insert into public.message_templates (survey_type, name, body, is_default) values
('purchased', 'Purchased customer – default',
 'Hi {{customer_name}}, thank you for choosing iDealz Lanka! We value your experience. Please take a moment to share your feedback through this short survey: {{survey_link}}. Your feedback helps us serve you better. Thank you!',
 true),
('non_purchased', 'Non-purchased customer – default',
 'Hi {{customer_name}}, thank you for visiting or contacting iDealz Lanka. We would appreciate your feedback to help us improve our service: {{survey_link}}. Thank you for your time!',
 true);

insert into public.system_settings (key, value, description) values
('company_name',          '"iDealz Lanka (Pvt) Ltd"', 'Legal company name shown on reports'),
('company_display_name',  '"iDealz Lanka"',           'Brand name shown to customers'),
('company_logo_url',      'null',                     'Public URL of the company logo (optional)'),
('support_phone',         'null',                     'Customer support phone shown on the privacy notice'),
('survey_expiry_days',    '14',                       'Days before a survey invitation link expires'),
('min_employee_sample',   '10',                       'Minimum responses before an employee is ranked'),
('min_branch_sample',     '20',                       'Minimum responses before a branch NPS is considered reliable'),
('data_retention_months', '36',                       'Months after the last interaction before customer identifiers are anonymised (0 = never)'),
('timezone',              '"Asia/Colombo"',           'Display timezone'),
('sms_daily_limit',       '2000',                     'Maximum survey SMS the platform will send per day');
