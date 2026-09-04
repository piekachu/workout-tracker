"""
Canonicalizes the many spelling/notation variants of exercise names found in
the raw CSVs into a small set of canonical exercise names + a category hint
(used to backfill workout_sessions.category for the Jun sheet, which has no
explicit per-block muscle-group header).

Rule-based on substring/keyword matches against the lowercased raw text, so
it's robust to leftover scheme text / typos / punctuation still attached to
the exercise name (no need for the name to be pre-cleaned).
"""
import re


def canonicalize(raw):
    """Return (canonical_name, category) or (None, None) if nothing matched."""
    s = re.sub(r"\s+", " ", (raw or "").strip().lower())
    if not s:
        return None, None

    pulldown_like = ("pull down" in s) or ("pulldown" in s) or bool(re.search(r"\bpds?\b", s))
    has_tricep = "tricep" in s

    # ---- Back ---------------------------------------------------------
    if "pull" in s and "up" in s:
        if any(k in s for k in ("neutral", "nutral", "n-grip", "ngrip", "n grip")) or s.startswith("ng "):
            return "Neutral-Grip Pull-ups", "Back"
        return "Pull-ups", "Back"
    if "t-bar" in s or "tbar" in s:
        return "T-Bar Row", "Back"
    if pulldown_like and not has_tricep:
        return "Lat Pulldown", "Back"
    if "barbell" in s and "row" in s:
        return "Barbell Row", "Back"
    if "cable" in s and "row" in s:
        return "Seated Cable Row", "Back"
    if "row" in s:
        return "Seated Row Machine", "Back"

    # ---- Chest ----------------------------------------------------------
    if "pec dec" in s or "pec deck" in s or "flies" in s or "fly" in s:
        return "Pec Deck Fly", "Chest"
    if "incline" in s:
        return "Incline Chest Press", "Chest"
    if ("dumbell" in s or "dumbbell" in s) and "curl" not in s:
        return "Dumbbell Chest Press", "Chest"
    if "smith machine bench" in s or "smith machine bp" in s or ("military press" in s and "bench" in s):
        return "Flat Bench Press (Smith Machine)", "Chest"
    if "chest press" in s or "chest/" in s:
        return "Chest Press Machine", "Chest"

    # ---- Legs -------------------------------------------------------------
    if "perfect squat" in s:
        return "Perfect Squats", "Legs"
    if "smith machine squat" in s:
        return "Smith Machine Squats", "Legs"
    if "leg press" in s:
        return "Leg Press", "Legs"
    if "leg extension" in s:
        return "Leg Extensions", "Legs"
    if "leg curl" in s:
        return "Seated Leg Curls", "Legs"
    if "abduct" in s:
        return "Hip Abduction", "Legs"
    if "adduct" in s:
        return "Hip Adduction", "Legs"

    # ---- Arms & Shoulders ---------------------------------------------
    if "military press" in s or "shoulder press" in s or "overhead press" in s:
        return "Overhead Press", "Shoulders"
    if "lateral raise" in s:
        return "Lateral Raises", "Shoulders"
    if "drag curl" in s:
        return "Dumbbell Drag Curls", "Arms"
    if "hammer curl" in s:
        return "Hammer Curls", "Arms"
    if "preacher" in s or "precher" in s:
        return "Preacher Curls", "Arms"
    if "reverse curl" in s:
        return "Reverse Curls", "Arms"
    if "barbell curl" in s or "biceps curl" in s or "bicep curl" in s or "arm curl" in s:
        return "Barbell Curls", "Arms"
    if has_tricep and "overhead" in s:
        return "Overhead Tricep Pulldown", "Arms"
    if has_tricep:
        return "Tricep Pulldown", "Arms"

    return None, None


# The 5 workout-day categories used by the app's logging form.
GROUPS = ["Back + Biceps", "Chest + Triceps", "Shoulder + Arms", "Legs", "Whole body"]

# Maps a canonicalize()d exercise name to one of GROUPS (biceps go with back,
# triceps go with chest, per how the user described their split).
EXERCISE_TO_GROUP = {
    "Pull-ups": "Back + Biceps",
    "Neutral-Grip Pull-ups": "Back + Biceps",
    "T-Bar Row": "Back + Biceps",
    "Lat Pulldown": "Back + Biceps",
    "Barbell Row": "Back + Biceps",
    "Seated Cable Row": "Back + Biceps",
    "Seated Row Machine": "Back + Biceps",
    "Hammer Curls": "Back + Biceps",
    "Preacher Curls": "Back + Biceps",
    "Reverse Curls": "Back + Biceps",
    "Barbell Curls": "Back + Biceps",
    "Dumbbell Drag Curls": "Back + Biceps",

    "Chest Press Machine": "Chest + Triceps",
    "Incline Chest Press": "Chest + Triceps",
    "Dumbbell Chest Press": "Chest + Triceps",
    "Pec Deck Fly": "Chest + Triceps",
    "Flat Bench Press (Smith Machine)": "Chest + Triceps",
    "Tricep Pulldown": "Chest + Triceps",
    "Overhead Tricep Pulldown": "Chest + Triceps",

    "Overhead Press": "Shoulder + Arms",
    "Lateral Raises": "Shoulder + Arms",

    "Perfect Squats": "Legs",
    "Smith Machine Squats": "Legs",
    "Leg Press": "Legs",
    "Leg Extensions": "Legs",
    "Seated Leg Curls": "Legs",
    "Hip Abduction": "Legs",
    "Hip Adduction": "Legs",
}


def group_for(exercise):
    return EXERCISE_TO_GROUP.get(exercise, "Whole body")


JUNK_LABEL_RE = re.compile(r"^[A-Za-z]{1,10}/\d+(\s*\+\s*[A-Za-z]{1,10}/\d+)*$")


def is_junk_label(raw):
    """Weekly-tally annotations like 'Back/8' or 'S/6 + Bi/6 + Tri/4' that got
    misparsed as exercise rows -- not real exercises."""
    return bool(JUNK_LABEL_RE.match((raw or "").strip()))
