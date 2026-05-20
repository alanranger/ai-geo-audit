
## 5. Extreme weight stress probes

Each row creates a named scenario with deliberately extreme weight values, activates it, and reads back the picker's Top 3. The intent is to verify the picker reads weights from the DB and that the weighted_score formula is sensitive enough to re-rank candidates under realistic strategic preferences.

### STRESS: Rank-only zealot

> EXTREME profile. Lever weights: rank=5.0, all others=0.01. Designed to force rank candidates to top 3 regardless of absolute monthly lift. If picker still returns CTR top 3 the weighted_score formula is too dominated by absolute lift.

Scenario ID: `cf7c56cd-04bd-4a51-b948-4f135142c3dd`

Tier weights: {"academy":1,"courses":1,"workshops_nonres":1,"workshops_residential":1,"services":1,"hire":1}

Lever weights: {"ctr":0.01,"schema":0.01,"aio":0.01,"rank":5,"surfacing":0.01,"conversion":0.01}

Picker Top 3 (with active=STRESS: Rank-only zealot):

| # | Lever | Tier | Mo GP lift | Weighted score | Applied tier w | Applied lever w |
|---|---|---|---:|---:|---:|---:|
| 1 | rank | academy | £49 | 245 | 1 | 5 |
| 2 | rank | workshops_nonres | £32 | 160 | 1 | 5 |
| 3 | rank | courses | £27 | 135 | 1 | 5 |

### STRESS: AIO-only zealot

> EXTREME profile. Lever weights: aio=5.0, all others=0.01. Forces AI Overview citation candidates to top.

Scenario ID: `4fc69002-db62-484b-bd5b-f5827c256a3c`

Tier weights: {"academy":1,"courses":1,"workshops_nonres":1,"workshops_residential":1,"services":1,"hire":1}

Lever weights: {"ctr":0.01,"schema":0.01,"aio":5,"rank":0.01,"surfacing":0.01,"conversion":0.01}

Picker Top 3 (with active=STRESS: AIO-only zealot):

| # | Lever | Tier | Mo GP lift | Weighted score | Applied tier w | Applied lever w |
|---|---|---|---:|---:|---:|---:|
| 1 | aio | hire | £26 | 130 | 1 | 5 |
| 2 | aio | academy | £24 | 120 | 1 | 5 |
| 3 | aio | courses | £14 | 70 | 1 | 5 |

### STRESS: Academy + Hire focus (high-GP tiers only)

> Tier emphasis test. Academy and Hire weighted 5.0 (very high-GP tiers), workshops/courses/services 0.05. Tests whether tier weights flow through.

Scenario ID: `ff044551-c039-4e33-8cf9-19796fba7758`

Tier weights: {"academy":5,"courses":0.05,"workshops_nonres":0.05,"workshops_residential":0.05,"services":0.05,"hire":5}

Lever weights: {"ctr":1,"schema":1,"aio":1,"rank":1,"surfacing":1,"conversion":1}

Picker Top 3 (with active=STRESS: Academy + Hire focus (high-GP tiers only)):

| # | Lever | Tier | Mo GP lift | Weighted score | Applied tier w | Applied lever w |
|---|---|---|---:|---:|---:|---:|
| 1 | ctr | academy | £275 | 1375 | 5 | 1 |
| 2 | ctr | hire | £99 | 495 | 5 | 1 |
| 3 | surfacing | hire | £0 | 250 | 5 | 1 |

### STRESS: Workshops survival mode

> Tier emphasis test inverse - workshops_residential + workshops_nonres at 5.0, all others 0.05. Tests "what if I had to dig myself out via workshops only?".

Scenario ID: `c782f1c4-05e8-44ac-8ff9-ffa144fe03ff`

Tier weights: {"academy":0.05,"courses":0.05,"workshops_nonres":5,"workshops_residential":5,"services":0.05,"hire":0.05}

Lever weights: {"ctr":1,"schema":1,"aio":1,"rank":1,"surfacing":1,"conversion":1}

Picker Top 3 (with active=STRESS: Workshops survival mode):

| # | Lever | Tier | Mo GP lift | Weighted score | Applied tier w | Applied lever w |
|---|---|---|---:|---:|---:|---:|
| 1 | surfacing | workshops_residential | £0 | 250 | 5 | 1 |
| 2 | surfacing | workshops_nonres | £0 | 250 | 5 | 1 |
| 3 | ctr | workshops_nonres | £46 | 230 | 5 | 1 |

### STRESS: All zeros except CTR (do only quick wins)

> Survival-mode test. Only CTR enabled, everything else 0 - effectively the picker should return ONLY CTR candidates regardless of tier.

Scenario ID: `703d8b62-f3fc-4c56-9abf-6c1809353623`

Tier weights: {"academy":1,"courses":1,"workshops_nonres":1,"workshops_residential":1,"services":1,"hire":1}

Lever weights: {"ctr":1,"schema":0,"aio":0,"rank":0,"surfacing":0,"conversion":0}

Picker Top 3 (with active=STRESS: All zeros except CTR (do only quick wins)):

| # | Lever | Tier | Mo GP lift | Weighted score | Applied tier w | Applied lever w |
|---|---|---|---:|---:|---:|---:|
| 1 | ctr | academy | £275 | 275 | 1 | 1 |
| 2 | ctr | courses | £102 | 102 | 1 | 1 |
| 3 | ctr | hire | £99 | 99 | 1 | 1 |

### STRESS: All zeros except Rank (compound-only)

> Inverse survival - only rank enabled. Verifies that filtering out a whole lever class returns an entirely different candidate list.

Scenario ID: `02622611-13ed-47a1-9543-c0400d2b5bdd`

Tier weights: {"academy":1,"courses":1,"workshops_nonres":1,"workshops_residential":1,"services":1,"hire":1}

Lever weights: {"ctr":0,"schema":0,"aio":0,"rank":1,"surfacing":0,"conversion":0}

Picker Top 3 (with active=STRESS: All zeros except Rank (compound-only)):

| # | Lever | Tier | Mo GP lift | Weighted score | Applied tier w | Applied lever w |
|---|---|---|---:|---:|---:|---:|
| 1 | rank | academy | £49 | 49 | 1 | 1 |
| 2 | rank | workshops_nonres | £32 | 32 | 1 | 1 |
| 3 | rank | courses | £27 | 27 | 1 | 1 |
