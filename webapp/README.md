# ORQIVRA 2.0 — Agricultural Resilience Workspace

ORQIVRA turns crop, climate and price observations into auditable evidence for farmers and extension teams, researchers and policymakers, and agricultural businesses. It provides historical screening, conditional yield scenarios and rigorous model evaluation. It does not claim guaranteed accuracy or validated farm outcomes.

## Start locally

From the project root:

```sh
bash webapp/setup.sh
```

Then start the API and frontend in separate terminals:

```sh
cd webapp/backend
source venv/bin/activate
python app.py
```

```sh
cd webapp/frontend
npm start
```

Open http://localhost:3000. The API listens on http://localhost:5001. Always use the virtual environment created by setup; a different system Python may lack dependencies. `app_port5001.py` remains a compatibility entry point for the same application.

Choose **Explore the resilience demo**, then **Build evidence workspace**. The demo has 192 synthetic observations across 16 years, three crops and four illustrative districts. Its yields use t/ha and prices use INR/t. These are not verified measurements from those districts.

## Workflows

| Workspace view | Purpose |
| --- | --- |
| Impact overview | Screen the latest observed year for local rainfall, temperature and yield changes; filter by crop/district; inspect suggested investigations. |
| Scenario lab | Estimate yield under hypothetical conditions, compare against local historical medians, inspect uncertainty and sensitivity, and save/export up to five scenarios. |
| Regional intelligence | Live regional weather, recent model history, soil estimates, evidence assistant, and backtested crop outlook. |
| Operations | Configure review thresholds, compare districts over shared years, calculate production assumptions, and track follow-up actions. |
| Model validation | Compare six models, audit time splits, inspect independent test error, subgroup performance and permutation importance. |
| Supply intelligence | Explore historical yield/price patterns and variability within a crop; identify groups to discuss with suppliers. |
| Data explorer | Filter/paginate observations, inspect exclusions and descriptive statistics, and export cleaned data or row-level audit records. |
| Methods & sources | Review intended uses, assumptions, limits and official data pathways. |

The audience selector emphasizes field, research or business questions. All views remain available for all audiences.

## Dataset contract

Required CSV columns:

- `Year`: whole year between 1900 and 2100.
- `Crop`: crop name.
- `Rainfall_mm`: nonnegative rainfall matched to the relevant growing period.
- `Avg_Temperature_C`: mean temperature, between −60 and 65°C.
- `Crop_Yield`: nonnegative yield in a consistent unit.
- `Market_Price`: nonnegative price in a consistent currency and unit.

Optional recognized columns: `District`, `Season`, `Humidity_Percent` (0–100), `Soil_pH` (0–14), and `Irrigation_mm` (nonnegative). When supplied, these columns must be valid on retained rows. Other columns remain available for exploration but are not model features.

Record source provenance, yield unit (`t/ha`, `kg/ha`, or unspecified), and price unit (`INR/t`, `INR/kg`, `USD/t`, `USD/kg`, or unspecified) at import. These are user declarations, not independently verified metadata. Units are recorded, not automatically converted.

Limits: 50 MB, 10,000 rows, and 100 distinct categories per recognized category column. At least 10 valid unique observations are required for exploration. Training requires 30 observations and two distinct yield values, plus sufficient development-fold support. Smaller datasets still receive descriptive analysis.

Cleaning converts known numeric fields, excludes nonfinite/missing values, invalid categories and physical-range violations, and removes duplicate observations across recognized columns. Unrelated notes do not make a duplicate unique. Missing values in unrelated columns do not discard an observation. Extreme but valid climate events are retained. The exclusion export includes original CSV row numbers and reasons; one row can have multiple reasons. A SHA-256 fingerprint of the canonical parsed CSV supports reproducibility.

## Modeling and accuracy

Candidate models:

1. Crop-mean baseline (unseen crops use the training global mean).
2. Ridge regression.
3. Quadratic/interacting climate features with ridge regression.
4. Random forest.
5. Extra trees.
6. Gradient boosting with Huber loss.

These are fixed reproducible candidate configurations, not an exhaustive hyperparameter search. The selection criterion is mean development-fold MAE; CV standard deviations describe fold variation, not confidence intervals.

With at least five distinct years and enough rows, the most recent approximately 20% of years form the final test, the preceding approximately 20% form calibration, and earlier years form development. Up to four expanding-window development folds select the model. Whole years never cross temporal partitions. If chronological partitions are not viable, an explicit seeded 60/20/20 random split with three-fold development CV is used and its limitations are shown. A temporal partition with insufficient valid development folds does not silently use shuffled CV.

All numeric scaling, polynomial features and category encoding are fitted inside each training fold. Model inputs include climate, crop and available district/season/soil/irrigation fields. `Year`, `Market_Price` and yield-derived quantities are excluded. Conditional prediction still depends on knowing or specifying the climate inputs; these scores are not weather-forecast accuracy.

The model with the lowest development CV MAE is selected before the final test is evaluated. The final report includes MAE, RMSE, R², change in error against the crop-mean baseline, subgroup metrics, and held-out predictions. R² can be negative and is unavailable for constant targets. Models and test data must not be repeatedly tuned after inspecting these scores and still be called independently validated.

### Uncertainty and scenarios

The selected model stays fitted on development data. Separate calibration residuals define a nominal 90% split-conformal interval using the finite-sample order statistic `ceil((n+1)*0.9)`. If that rank exceeds the calibration sample count, a finite interval is unavailable. Final-test empirical coverage is reported separately.

The usual coverage interpretation requires exchangeability; time dependence, distribution shifts, regional differences and model misuse can reduce coverage. The global calibration interval is not a per-crop or per-district coverage guarantee. It can extend below zero because it is an untruncated statistical interval.

Scenario inputs must match the model feature contract and use a crop/location/season combination observed during training. Conditions outside that group's observed feature ranges are flagged and their intervals withheld. Staying within every individual range does not guarantee that the joint combination is supported. Local medians define the reference; presets are stress tests, not future climate projections. Sensitivity curves change one variable at a time, not a causal intervention.

## Historical review signals

For each crop/location/season, compare the latest dataset year with the median of up to five previous annual means. Require at least three historical years. Each historical year has equal weight. Screening thresholds are rainfall at least 20% lower, temperature at least 1°C higher, or yield at least 15% lower.

These are transparent review heuristics, not calibrated drought/heat hazard probabilities. Missing groups in the latest year are reported. Annual overview charts aggregate represented locations; composition changes may affect means. Price variability is the sample standard deviation divided by the mean of prior annual means. Prices are nominal and not inflation-adjusted. Yield per hectare does not establish production volume, profit, inventory, water savings, emissions reductions or food-security outcomes.

## Regional intelligence and evidence assistant

Search a town or district and confirm its state/country. ORQIVRA requests current weather, the preceding seven days of archived model data, and a seven-day forecast (today plus six days) from Open-Meteo. It displays temperature, humidity, wind, precipitation/probability, reference ET₀, modeled soil temperature at 6 cm and soil moisture at 3–9 cm. None of these are claimed to be farm sensor readings. Current precipitation covers the provider's current interval; today's forecast totals include elapsed hours.

Weather requests have a 15-second timeout and a bounded 64-entry in-memory cache (15 minutes for forecasts, one day for location search). Retrieval timestamps remain unchanged on cache hits. Provider errors return 503; missing values remain unavailable rather than becoming zero. Old snapshots remain visibly timestamped and are marked stale after three hours from retrieval or six hours from their model timestamp. The assistant suppresses weather-triggered actions for stale snapshots. TLS verification is enabled, with the OS CA bundle loaded when available.

The free Open-Meteo endpoint is intended for non-commercial use; commercial deployment needs an appropriate provider arrangement. Attribution is included in the interface and exports. Search terms and selected coordinates go to Open-Meteo. Uploaded crop data and field inputs do not leave this backend. Network access is required for weather, but the assistant can still analyze uploaded history without it.

The assistant is explicitly a deterministic evidence retrieval/calculation bot, not a general-purpose LLM. It supports weather, water review, soil evidence, crop history, future outlook and summary questions. Unsupported questions receive a scope explanation. Each answer identifies its sources, context and gaps. Historical district/season selection is explicit; geographic matching to the weather point is user-declared, not independently verified. Optional crop stage, texture and measured pH provide field context, not automated agronomic prescriptions.

Generic review triggers are heat ≥35°C, frost ≤0°C, daily precipitation ≥25 mm, and seven-day reference ET₀ exceeding precipitation. They are investigation prompts, not calibrated crop hazards, flood warnings or irrigation doses. Missing daily values withhold seven-day totals. Crop coefficient, soil storage, effective rainfall and management are not known. The bot does not prescribe fertilizer/pesticide doses, diagnose disease, or claim crop suitability.

The history-only yield outlook requires eight observed years per selected crop/location/season. It backtests nonnegative linear trend and last-observed-yield predictions over up to five chronological holdouts, selects the lower MAE, and projects three years after the last observation. The backtest is used for model selection and is not an independent test. Stress bounds add/subtract the maximum selected-method backtest error; these are not confidence intervals, do not widen with horizon, and have no guaranteed coverage. Short-term weather is not fed into a model trained on annual/seasonal features. Outdated and synthetic histories are explicitly identified.

Save suggested investigations directly to the Operations action register. Export the regional brief to retain weather, context, crop history, outlook, sources and dataset fingerprint. Weather snapshots share workspace expiry. Chat history and unsaved field context are frontend state and reset on reload.

## Operations workspace

Custom reviews select an observed year, 3–10 earlier reference years, and rainfall/yield percentage or temperature thresholds. They exclude later observations and leave the original analysis unchanged. At least three earlier years are still required. Export each review with its settings and dataset fingerprint.

District comparisons use one crop and season, 2–6 districts, and only years observed in every selected district. Annual means receive equal weight, avoiding over-weighting heavily sampled years. These are descriptive comparisons, not suitability rankings or causal effects.

The production planner converts explicitly supplied area, yield (t/ha or kg/ha), and a loss allowance into gross, lost and available tonnes. These are arithmetic planning assumptions, not forecasts. Results and assumptions can be exported as JSON.

The action tracker supports up to 100 actions per dataset, with an owner, due date, priority, notes, and Open/In progress/Done status. Draft actions from review signals, edit them, filter by status, or export a CSV register. Saved actions survive page reloads only while the in-memory workspace exists; no notifications or reminders are sent. Unsaved forms, review results and comparison results are frontend state and should be exported before reloading.

## API and workspace lifecycle

`POST /api/upload` or `POST /api/demo` returns a random `dataset_id`. Send it in `X-Dataset-ID` for subsequent workspace operations. The frontend keeps it in per-tab session storage; reloads restore analysis while the backend workspace survives. Tokens are bearer capabilities, not user accounts.

| Endpoint | Action |
| --- | --- |
| `GET /api/health` | Health/version |
| `GET /api/download-sample` | Synthetic template CSV in JSON |
| `GET /api/workspace` | Dataset metadata and cached results |
| `POST /api/analyze` | Build/cached analysis; concurrent same-workspace requests return 409 |
| `GET /api/results` | Completed analysis |
| `GET /api/stats` | Metadata and data types |
| `GET /api/data` | Filter by crop/district/year bounds and paginate |
| `POST /api/scenario` | JSON `{ "inputs": { ...modelFeatures } }` |
| `GET /api/regional/locations?q=...` | Search public locations |
| `GET /api/regional/weather` | Restore the workspace weather snapshot |
| `POST /api/regional/weather` | Fetch weather for `{latitude, longitude, name}` |
| `POST /api/regional/assistant` | Evidence brief for `{crop, district, season, question, stage, texture, soil_ph}` |
| `GET /api/operations` | Action register and observed years/seasons |
| `POST /api/operations/review` | Configurable historical screening |
| `POST /api/operations/benchmark` | Shared-year district comparison |
| `POST /api/operations/production` | Explicit-unit production arithmetic |
| `POST /api/operations/tasks` | Add a follow-up action |
| `PATCH /api/operations/tasks/<id>` | Edit action fields/status |
| `GET /api/export/actions` | Action register CSV |
| `GET /api/export/cleaned` | Cleaned CSV |
| `GET /api/export/rejected` | Exclusion audit CSV |
| `GET /api/export/predictions` | Held-out predictions CSV |
| `GET /api/export/report` | Full JSON evidence report |

Uploads are read in memory and never saved under user-supplied filenames. CSV exports neutralize formula-like text. Workspaces expire after two idle hours and the store holds at most eight; the least recently used workspace is evicted at capacity. Server restart clears all data. Saved scenario comparisons are frontend state: export them before reloading.

This is a local research application. It does not provide account authentication, durable storage, distributed jobs or multi-process shared state. Public deployment requires those capabilities, transport security and operational validation. It is not ready to be deployed as a shared production service.

Configuration: `PORT` changes the API port; `REACT_APP_API_URL` changes the frontend API origin at build/start time; `ORQIVRA_ORIGINS` (legacy `AGROSCOPE_ORIGINS` remains supported) is a comma-separated CORS allowlist (defaults to localhost and 127.0.0.1 on port 3000).

## Verification

```sh
webapp/backend/venv/bin/python -m unittest discover -s webapp/backend -v
npm run build --prefix webapp/frontend
```

Tests cover strict JSON, model selection independence from final-test labels, temporal partition separation, conformal order statistics, scenario extrapolation, validation and audit exports, workspace isolation/expiration/capacity, limited-data behavior, retrospective review boundaries, equal-year district weighting, production unit conversion, action validation, action-register isolation, forecast period boundaries, missing weather values, stale-weather suppression, weather workspace isolation, provider failures, and chronological crop-outlook backtests.

## Sources and real-world validation

- [Scikit-learn cross-validation](https://scikit-learn.org/stable/modules/cross_validation.html): validation design and time-dependent observations.
- [Introduction to conformal prediction](https://arxiv.org/abs/2107.07511): uncertainty assumptions and limits.
- [FAO climate and disaster risk management](https://www.fao.org/climate-change/cross-cutting-areas/climate-and-disaster-risk-management/en): context for evidence-informed agricultural resilience.
- [FAOSTAT crop statistics](https://www.fao.org/faostat/en/#data/QCL) and [NASA POWER](https://power.larc.nasa.gov/): potential data sources; align geography, periods, crop definitions and units before joining. The app does not automatically download or verify these sources.

Before operational use, test prospectively on independent local observations from a new season, review errors with agricultural specialists, and monitor subgroup coverage and distribution changes. Synthetic-demo performance cannot establish accuracy on real farms.

## ORQIVRA visual identity

The interface follows the supplied ORQIVRA nature-tech reference: a leaf-shaped Q emblem, widely spaced uppercase wordmark, the headline “Intelligence rooted in nature,” warm ivory surfaces, forest/olive greens and restrained gold accents. The logo is recreated as editable SVG rather than a cropped brand-board image.

Brand assets live in `frontend/public/brand/`: the transparent emblem, rounded app icon, maskable icon and botanical illustration. PNG app icons are included at 192 and 512 pixels. Browser favicon, Apple touch icon and the web manifest use these assets. Theme rules live in `frontend/src/brand.css`. The manifest supplies home-screen identity; this change does not add offline functionality. Existing workspace session tokens and the previous CORS environment variable remain compatible.
