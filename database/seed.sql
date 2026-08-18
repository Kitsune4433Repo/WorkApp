-- Local/dev seed data only. Every account below uses the password: password123

INSERT INTO users (email, password_hash, full_name, role, hourly_rate_cents, is_active) VALUES
    ('admin@crewops.dev',      '$2a$12$KrFvE7vtcmwjHKFIicZir.vSSejEdeTiLslQdKJEjKU2uJuQ.iPeO', 'Alex Admin',        'admin',      0,    true),
    ('dispatch@crewops.dev',   '$2a$12$KrFvE7vtcmwjHKFIicZir.vSSejEdeTiLslQdKJEjKU2uJuQ.iPeO', 'Dana Dispatcher',   'dispatcher', 0,    true),
    ('lead@crewops.dev',       '$2a$12$KrFvE7vtcmwjHKFIicZir.vSSejEdeTiLslQdKJEjKU2uJuQ.iPeO', 'Lee CrewLead',      'crew_lead',  3200, true),
    ('tech1@crewops.dev',      '$2a$12$KrFvE7vtcmwjHKFIicZir.vSSejEdeTiLslQdKJEjKU2uJuQ.iPeO', 'Terry Technician',  'technician', 2800, true),
    ('tech2@crewops.dev',      '$2a$12$KrFvE7vtcmwjHKFIicZir.vSSejEdeTiLslQdKJEjKU2uJuQ.iPeO', 'Sam Fielder',       'technician', 2800, true)
ON CONFLICT (email) DO NOTHING;

INSERT INTO material_catalog (sku, name, category, unit, description, created_by)
SELECT * FROM (VALUES
    ('FIB-SM-1000', 'Single-mode fiber, 1000ft spool', 'fiber',      'spool', 'OS2 single-mode, yellow jacket'),
    ('CONN-SC-APC', 'SC/APC connector',                'connectors', 'ea',    'Pre-polished SC/APC fast connector'),
    ('SPL-CLOS-24', '24-port splice closure',           'enclosures', 'ea',    'Dome splice closure, 24 fiber capacity'),
    ('CAT6-1000',   'Cat6 cable, 1000ft box',            'copper',     'box',   'Plenum-rated Cat6, blue jacket'),
    ('DROP-CBL-500','Aerial drop cable, 500ft spool',    'fiber',      'spool', '2-strand aerial drop, self-supporting')
) AS v(sku, name, category, unit, description)
CROSS JOIN (SELECT id FROM users WHERE email = 'admin@crewops.dev') AS admin(id)
ON CONFLICT (sku) DO NOTHING;

INSERT INTO jobs (job_number, title, description, status, priority, site_address, site_location, geofence_radius_m, scheduled_start, created_by)
SELECT
    'JOB-1001',
    'Fiber splice — 142 Elm St',
    'Splice new drop into existing closure, test end-to-end loss.',
    'scheduled',
    'normal',
    '142 Elm St, Springfield',
    ST_GeogFromText('SRID=4326;POINT(-93.2650 44.9778)'),
    75,
    now() + interval '1 day',
    id
FROM users WHERE email = 'dispatch@crewops.dev'
ON CONFLICT (job_number) DO NOTHING;
