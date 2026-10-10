# Exercise media credits

## Videos: CC BY-SA 4.0

Exercise demonstration videos come from the [wger](https://wger.de) exercise database and are
licensed under [Creative Commons Attribution-ShareAlike 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
FORGE trims each clip to a short loop, scales it, removes the audio and re-encodes it. These
modified versions are shared under the same licence.

| Exercise | Author | Original |
| --- | --- | --- |
| assisted-pull-up | Goulart | https://wger.de/en/exercise/477/view/ |
| barbell-bench-press | Goulart | https://wger.de/en/exercise/73/view/ |
| barbell-curl | Goulart | https://wger.de/en/exercise/91/view/ |
| barbell-hip-thrust | Goulart | https://wger.de/en/exercise/294/view/ |
| cable-lateral-raise | Goulart | https://wger.de/en/exercise/349/view/ |
| cable-rope-hammer-curl | Goulart | https://wger.de/en/exercise/275/view/ |
| chest-dip | Goulart | https://wger.de/en/exercise/194/view/ |
| dumbbell-bench-press | Goulart | https://wger.de/en/exercise/75/view/ |
| dumbbell-curl | Goulart | https://wger.de/en/exercise/92/view/ |
| dumbbell-kickback | Goulart | https://wger.de/en/exercise/655/view/ |
| dumbbell-lateral-raise | Goulart | https://wger.de/en/exercise/348/view/ |
| dumbbell-romanian-deadlift | Goulart | https://wger.de/en/exercise/507/view/ |
| dumbbell-skull-crusher | Goulart | https://wger.de/en/exercise/245/view/ |
| dumbbell-split-squat | Goulart | https://wger.de/en/exercise/205/view/ |
| dumbbell-walking-lunge | Goulart | https://wger.de/en/exercise/206/view/ |
| face-pull | Goulart | https://wger.de/en/exercise/222/view/ |
| front-squat | Goulart | https://wger.de/en/exercise/257/view/ |
| hammer-curl | Goulart | https://wger.de/en/exercise/272/view/ |
| leg-press | Goulart | https://wger.de/en/exercise/371/view/ |
| lying-leg-curl | Goulart | https://wger.de/en/exercise/365/view/ |
| machine-bicep-curl | Goulart | https://wger.de/en/exercise/465/view/ |
| machine-shoulder-press | Goulart | https://wger.de/en/exercise/543/view/ |
| overhead-dumbbell-triceps-extension | Goulart | https://wger.de/en/exercise/211/view/ |
| preacher-curl | Goulart | https://wger.de/en/exercise/465/view/ |
| pull-up | Goulart | https://wger.de/en/exercise/475/view/ |
| seated-cable-row | Goulart | https://wger.de/en/exercise/512/view/ |
| seated-calf-raise | Goulart | https://wger.de/en/exercise/590/view/ |
| seated-leg-curl | Goulart | https://wger.de/en/exercise/366/view/ |
| single-arm-cable-pushdown | Goulart | https://wger.de/en/exercise/803/view/ |
| single-arm-dumbbell-preacher-curl | Goulart | https://wger.de/en/exercise/584/view/ |
| skull-crusher | Goulart | https://wger.de/en/exercise/246/view/ |
| smith-machine-squat | Goulart | https://wger.de/en/exercise/341/view/ |

## Photos: public domain

Start and end position photos come from [free-exercise-db](https://github.com/yuhonas/free-exercise-db),
released under the [Unlicense](https://unlicense.org/). FORGE resizes them and converts them to WebP.

## Animations: ExerciseDB (AscendAPI)

Exercises with neither a video nor a photo pair use the open-source 180p GIF animations from
ExerciseDB by AscendAPI, as published in the Kaggle dataset
[fitness-exercises-dataset](https://www.kaggle.com/datasets/exercisedb/fitness-exercises-dataset),
which lists the MIT licence (see `exercisedb-LICENSE.txt`). FORGE scales each GIF to 360 px and
re-encodes it as a muted video loop.

Licence caveat: the ExerciseDB API code repository (github.com/ExerciseDB/exercisedb-api) is
AGPL-3.0, and AscendAPI sells "commercial rights" with its paid plans. Confirm the terms for the
open-source animations with AscendAPI before a commercial launch. Removing every `animation`
entry from scripts/media/mapping.json and running `pnpm media:build` takes them out.

| Exercise | ExerciseDB id | ExerciseDB name |
| --- | --- | --- |
| archer-push-up | A9qxk2F | archer push up |
| band-curl | 3omWx6P | band alternating biceps curl |
| band-lat-pulldown | 4LoWllp | Band Fixed Back Close-Grip Pulldown |
| band-pallof-press | 9pa4H5m | band horizontal pallof press |
| band-row | Nu7jqFE | Band Seated Straight Back Row |
| barbell-thruster | f7Y9eDZ | barbell thruster |
| bear-crawl | 0Yz8WdV | bear crawl |
| burpee | dK9394r | burpee |
| butt-kicks-primer | oLrKqDH | run |
| butterfly-stretch | bWlZvXh | butterfly yoga pose |
| cable-kickback | vvNjDJS | Cable Two-Arm Triceps Kickback |
| calf-raise-primer | bJYHBIN | bodyweight standing calf raise |
| cobra-stretch | 01qpYSe | upward facing dog |
| cossack-squat-mobility | GWoKnIm | Weighted Cossack Squats |
| curtsy-lunge | gUjqdei | curtsey squat |
| dumbbell-snatch | 6pTkI99 | Dumbbell Single-Arm Snatch |
| dumbbell-y-raise | PbzNu7c | dumbbell incline y-raise |
| fast-feet | mweqJin | quick feet |
| frog-rock | 2Dk4xQV | rocking frog stretch |
| hanging-knee-raise | VEcJRo2 | hanging leg hip raise |
| hanging-leg-raise | 4Ml7QFO | Hanging Straight-Leg Raise |
| jumping-jacks | f9lVSSI | Astride Jumps |
| kettlebell-snatch | aXcUyKb | Kettlebell Single-Arm Snatch |
| kettlebell-swing | UHJlbu3 | kettlebell swing |
| knee-push-up | ZOuKWir | Kneeling Push-Up |
| knee-side-plank | RKjH6Lt | side bridge |
| lat-stretch | chfnQnM | back pec stretch |
| machine-lateral-raise | dRTfGZT | Machine Lateral Raise |
| mountain-climber | RJgzwny | mountain climber |
| overhead-carry | mWBtgmb | dumbbell single arm overhead carry |
| pendlay-row | r0z6xzQ | barbell pendlay row |
| plank-shoulder-tap | yRpV5TC | shoulder tap |
| scapular-push-up | jV65tKx | scapula push-up |
| single-leg-calf-raise | 0jp9Rlz | Single-Leg Floor Calf Raise |
| sissy-squat | xdYPUtE | sissy squat |
| ski-erg | vpQaQkH | ski ergometer |
| ski-erg-intervals | vpQaQkH | ski ergometer |
| sprint-intervals | oLrKqDH | run |
| standing-ab-wheel-rollout | KtRomty | Standing Wheel Rollout |
| toes-to-bar | nuBF9MO | hanging pike |
| underhand-barbell-row | SzX3uzM | Barbell Reverse-Grip Bent Over Row |
| warmup-jumping-jacks | f9lVSSI | Astride Jumps |
| wrist-circles | 2zNKRUB | wrist circles |
