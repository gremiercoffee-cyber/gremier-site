# Production workers and stock controls

Production uses the existing Workers list and rates, plus an explicit Owner option. These are attendance identities on an authenticated admin device, not separate employee authentication accounts. No worker passwords or broader backend access are created.

## Logging and shifts

- Select a person before logging production. Kiosk mode asks “Who’s working now?” and starts or resumes that person's shift. Changing the person does not silently clock out another worker: several workers can be working at once.
- Clock out explicitly. Closing the browser, leaving kiosk mode, or a tablet sleeping does not imply the worker stopped working. Opening an active kiosk asks again who is working.
- Widget forms include Performed by, and Workers has Clock in / Clock out. Refresh the widget to fetch the new server-driven fields. The updated APK also adds worker selection to voice confirmation.
- `production_execute` validates the person/shift and sets transaction-local attribution before calling the existing atomic production RPC. A trigger records brewing, draining, bottling, labelling and inferred delivery shortfalls alongside stock. Legacy paths without attribution remain Unassigned; historical people are never guessed.
- Production entries paginate by 50 and can be filtered by person. Worker/note corrections create an immutable before/after audit and do not change stock. Quantities remain the actual stock transaction; corrections to attribution are not inventory adjustments.
- Reversing a bottling transaction marks its work entry reversed, and excludes it from completed-work totals.

## Hours and pay

Each worker has at most one open shift across devices; Owner also has at most one. Clock-in requests and clock-out are retry-safe. Closed shifts create one linked `worker_entries` row. Hours use actual elapsed seconds, including overnight/DST boundaries. Pay is rounded to cents using the hourly rate captured at clock-in. Later rate changes do not rewrite old shifts. Owner attendance has no wage entry.

Workers shows active shifts, completed hours and work totals by product/task, plus shift history. Correct times recalculates the existing linked pay entry and checks for overlap. Linked pay rows cannot be directly deleted/changed independently of their shifts. Existing manual hours/payments remain unchanged. Unclocked production has attribution but does not invent hours or wages. The data supports future efficiency reports; total shift hours should not be mistaken for measured time spent on each individual task.

## Stock editing

Concentrate buttons move 0.5 L; bean buttons move 1 kg; finished stock and labels move one whole unit. Concentrate and beans accept manually typed decimals up to three places. Button adjustments preserve existing fractional precision (e.g. 1.975 L + 0.5 L = 2.475 L).

Inputs select their contents on focus, allow clearing while typing, strip leading zeroes, and save on blur/Enter. Escape cancels typing. Empty/invalid input restores the saved value. Finished quantities reject fractions. Requests within a row are serialized, later drafts are protected from intermediate server responses, and failed saves remain retryable. Manual stock editing never implies bottling or consumes concentrate; use Production to log work.

## Verification

- `node --test scripts/test-stock-controls.cjs` exercises draft editing, fractions, increments, rapid taps, serialized saves and retries.
- `scripts/test-production-workers.sql` is rollback-only: attribution, recipes, idempotence, rate snapshots, payroll, corrections, closed/mismatched shift rejection and admin guards.
- Existing production transaction SQL tests remain applicable.
