-- Local/dev seed data only. Every account below uses the password: password123

INSERT INTO users (email, password_hash, full_name, role, hourly_rate_cents, is_active) VALUES
    ('admin@crewops.dev',      '$2a$12$KrFvE7vtcmwjHKFIicZir.vSSejEdeTiLslQdKJEjKU2uJuQ.iPeO', 'Alex Admin',        'admin',      0,    true),
    ('dispatch@crewops.dev',   '$2a$12$KrFvE7vtcmwjHKFIicZir.vSSejEdeTiLslQdKJEjKU2uJuQ.iPeO', 'Dana Dispatcher',   'crew_lead',  0,    true),
    ('lead@crewops.dev',       '$2a$12$KrFvE7vtcmwjHKFIicZir.vSSejEdeTiLslQdKJEjKU2uJuQ.iPeO', 'Lee CrewLead',      'crew_lead',  3200, true),
    ('tech1@crewops.dev',      '$2a$12$KrFvE7vtcmwjHKFIicZir.vSSejEdeTiLslQdKJEjKU2uJuQ.iPeO', 'Terry Technician',  'crew',       2800, true),
    ('tech2@crewops.dev',      '$2a$12$KrFvE7vtcmwjHKFIicZir.vSSejEdeTiLslQdKJEjKU2uJuQ.iPeO', 'Sam Fielder',       'crew',       2800, true)
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
    'medium',
    '142 Elm St, Springfield',
    ST_GeogFromText('SRID=4326;POINT(-93.2650 44.9778)'),
    75,
    now() + interval '1 day',
    id
FROM users WHERE email = 'dispatch@crewops.dev'
ON CONFLICT (job_number) DO NOTHING;

-- Knowledge base (feature 11): a few realistic articles so full-text search has real content to
-- match against. INSERT ... SELECT WHERE NOT EXISTS since the table has no natural unique key to
-- ON CONFLICT against.
INSERT INTO knowledge_base_articles (title, content, category, tags, created_by)
SELECT v.title, v.content, v.category, v.tags, admin.id
FROM (
    VALUES
    (
        'Single-Mode Fusion Splicing Procedure',
        '1. Strip 30-40mm of jacket from each fiber and clean with lint-free wipes and 99% isopropyl alcohol.
2. Cleave at 8mm using a precision cleaver; inspect the cleave angle under the splicer''s camera — reject anything over 0.5 degrees.
3. Load both fibers into the fusion splicer, align on core (not cladding) for single-mode work, and run the automatic splice cycle.
4. Confirm estimated loss on the splicer display is under 0.05 dB before proceeding; re-splice if not.
5. Heat-shrink the splice protector for a minimum of 90 seconds in the splicer''s oven before moving the fiber.
6. Coil excess fiber to the closure''s minimum bend radius and seat in the splice tray — never let a fiber cross a tray divider under tension.',
        'splicing',
        ARRAY['fusion-splicing', 'single-mode', 'otdr', 'closure']
    ),
    (
        '24-Port Dome Closure Installation Guide',
        E'Applies to SPL-CLOS-24 dome closures. Mount the closure at a low point in the cable run where possible so '
        'condensation drains away from the splice trays. Torque the dome clamps to the manufacturer spec (typically '
        '12-15 Nm) — under-torquing is the leading cause of field water intrusion. Dress all fiber loops to at least '
        'the cable''s rated minimum bend radius before closing the dome. Pressure-test with the supplied hand pump to '
        '5 psi and hold for 2 minutes with no drop before leaving the site; log the result in the job ticket''s photo '
        'proof notes.',
        'enclosures',
        ARRAY['closure', 'installation', 'sealing', 'dome']
    ),
    (
        'OTDR Testing & Acceptable Loss Thresholds',
        E'Test bidirectionally whenever possible and average the two results — unidirectional OTDR traces can hide '
        'gainers/losers depending on core mismatch direction. Acceptable splice loss is 0.10 dB or better for '
        'single-mode fusion splices; anything over 0.30 dB should be re-spliced, not just noted. Total end-to-end '
        'loss budget for a standard drop run (splice + connectors + fiber attenuation) should not exceed 3.0 dB — '
        'flag the job as blocked and notify dispatch if a run exceeds this after two re-splice attempts.',
        'testing',
        ARRAY['otdr', 'testing', 'loss-budget', 'acceptance-criteria']
    ),
    (
        'PPE Requirements — Aerial & Underground Work',
        E'Aerial (bucket truck / pole climbing): hard hat with chin strap, safety glasses, Class E rubber gloves '
        'rated for the line voltage present, fall-protection harness clipped in above waist level at all times '
        'above 4 feet. Underground/vault work: confined-space entry permit required before opening any vault rated '
        'confined space, atmospheric testing (O2, LEL, CO, H2S) before entry and every 30 minutes during occupied '
        'work, a dedicated attendant stationed at the entry point at all times. Fiber splicing specifically: safety '
        'glasses are mandatory any time a fiber is being cleaved or scrapped — bare fiber shards are a puncture and '
        'ingestion hazard and are nearly invisible on skin or clothing.',
        'compliance',
        ARRAY['ppe', 'safety', 'osha', 'confined-space']
    ),
    (
        'Fusion Splicer Maintenance & Calibration',
        E'Clean the V-grooves and fiber clamps with a dry-fiber brush and alcohol wipe at the start of every shift — '
        'grit in the V-groove is the most common cause of poor cleave alignment in the field. Replace electrodes '
        'every 3,000-5,000 splices per the manufacturer''s counter, sooner if arc calibration starts drifting or '
        'splice loss trends upward across otherwise-good cleaves. Run the built-in arc calibration test weekly and '
        'whenever the splicer has been transported at altitude or temperature extremes. A splicer that fails '
        'calibration twice in a row should be pulled from service and sent for factory service, not field-repaired.',
        'equipment',
        ARRAY['fusion-splicer', 'maintenance', 'calibration']
    )
) AS v(title, content, category, tags)
CROSS JOIN (SELECT id FROM users WHERE email = 'admin@crewops.dev') AS admin(id)
WHERE NOT EXISTS (SELECT 1 FROM knowledge_base_articles k WHERE k.title = v.title);
