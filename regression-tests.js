/* ============================================================
   REGRESSION TEST SUITE — Smart Remedy AI matching engine
   ============================================================
   NOT loaded by index.html and NOT part of the live app. This file exists
   purely so any future change to script.js/repertory.json/remedies.json can
   be checked against every case already confirmed correct today, in seconds,
   instead of relying on someone remembering to re-test broadly by hand.

   HOW TO RUN:
   Open test.html (in this same folder) in a browser. It loads the real
   script.js + repertory.json + remedies.json, then runs every case below
   and shows a pass/fail table. Nothing here touches the live site.

   HOW TO EXTEND:
   - When a new bug is found and fixed, add the case that proves the fix to
     PASSING_CASES below, with the exact remedy id it must return as #1.
   - If a case is a known, not-yet-fixed issue, add it to KNOWN_ISSUES
     instead — it's tracked and displayed, but doesn't fail the suite. Move
     it up into PASSING_CASES once it's actually fixed and verified.
   ============================================================ */

const PASSING_CASES = [
  {
    name: "Paralysis of tongue (mandatory-condition gate)",
    text: "paralysis of tongue",
    mustNotBeTop: "tarax", // Taraxacum must never win — matches only on "tongue", nothing to do with paralysis
    notes: "Verifies SIGNIFICANT_CONDITION_WORDS hard-rejects remedies that don't share the named condition."
  },
  {
    name: "Ear infection — clingy child (generic-evidence discount + trigger phrasing)",
    text: "My baby's been getting ear infections over and over, doctor, always the left ear it seems. She's a clingy little thing, doesn't want anyone but me holding her, cries the second I put her down. The discharge is thick and yellowish, doesn't really smell bad. She doesn't seem thirsty even with the fever.",
    expectTopId: "puls",
    notes: "Apis previously won this purely off the generic 'thirstless' rubric with zero connection to ears/clinginess."
  },
  {
    name: "Grief, 8 months, tear up from small questions (repertory trigger phrasing + Nat-mur guardrail)",
    text: "I lost my husband eight months ago, doctor, and I just can't seem to function properly since. Even small questions from my accountant make me tear up out of nowhere. I've stopped going into the office, which isn't like me at all, I used to run that place with an iron grip.",
    expectTopId: "nat-mur",
    notes: "Nat-mur's own breadth guardrail was wrongly halving a single genuinely strong grief match."
  },
  {
    name: "Constipation, stool recedes after partial expulsion (missing keynote + bare topic-word match)",
    text: "The patient is constipated. Stool comes a little and then goes back.",
    expectTopId: "sil",
    notes: "Silicea's 'bashful stool' keynote was entirely missing from the data; Alumina/Bryonia also matched purely on the bare word 'stool'."
  },
  {
    name: "Chronic constipation — full detail (must still work after the bare-'stool' fix above)",
    text: "chronic constipation hard stool in the beginning incomplete evacuation ineffectual urging bloating sedentary lifestyle",
    expectTopId: "nux-v",
    notes: "Confirms the WEAK_MODIFIER_WORDS fix for 'stool'/'constipation' didn't break cases with real distinguishing detail."
  },
  {
    name: "Allium cepa cold — thin watery discharge burns lip, bland tears, better open air",
    text: "Doctor I've had a cold since yesterday but its gotten so much worse today. My nose is running like a tap, but its thin and watery, not thick, and honestly it burns my upper lip a bit where it keeps dripping. Strange thing is my eyes are watering too but that discharge doesn't burn at all, its bland. I keep sneezing, one after another. I feel a bit better outdoors, in the fresh air, but the moment I come back inside the stuffy room makes me feel worse and I start coughing. I don't have much thirst even though I'm sick.",
    expectTopId: "all-c"
  },
  {
    name: "Bryonia back spasm — worse any motion, better firm pressure, must lie still",
    text: "My back has been in spasm since this morning, doctor, I bent down to pick something off the floor and suddenly it just locked up, I could barely straighten myself. Any small movement makes it so much worse, even breathing deeply hurts. If I press on it firmly with my hand it actually feels a little better, some relief from firm pressure. I feel like I need to just lie flat and not move at all otherwise it's unbearable.",
    expectTopId: "bry",
    notes: "Originally lost to Rhus Tox via a false 'locked up' trigger match; also broke temporarily when Modalities was made wholesale-generic."
  },
  {
    name: "Antimonium Tart — loose rattling cough can't expectorate, weak, thirstless, chest heavy",
    text: "I've had this cough for a week, doctor, and its got a lot of mucus, I can hear it rattling in my chest but I just can't seem to bring it up, its so hard to cough it out. I'm exhausted, feel very weak, don't really want to eat much. What's strange is I don't feel very thirsty even though my mouth is a bit dry. My chest feels heavy, like there's a weight sitting on it.",
    expectTopId: "ant-t"
  },
  {
    name: "Colocynthis colic — better bending double/pressure, worse walking, from anger",
    text: "I've had this stomach pain for two days, doctor, it's like a griping, cramping pain that comes in waves, and honestly the only thing that helps even a little is if I bend forward and press my fist hard into my belly. Walking around or lying straight makes it so much worse. It started right after I had a fight with my sister, I was so angry I could barely speak, just stormed off. Since then this pain has been on and off.",
    expectTopId: "coloc",
    notes: "Originally lost to Arsenicum Album via typo-corruption ('could' -> 'cold', 'speak' -> 'sweat')."
  },
  {
    name: "Sulphur itchy scalp — worse heat/hot shower, better cool air, philosophical, untidy, 11am hunger",
    text: "Doctor, my scalp's been so itchy and flaky for years now, comes and goes. It's much worse if I take a hot shower, and honestly it's worse in general if I get too warm in bed. Cold air actually feels nice on it. I'll be honest, I love a good debate, I could talk for hours about politics or philosophy, my wife rolls her eyes at me for it. I'm not the tidiest person either, my study is a mess and I don't really care. Around 11 in the morning I get ravenous, if I don't eat right then I get shaky and short-tempered.",
    expectTopId: "sulph",
    notes: "Originally lost to Apis via the generic 'worse heat, better cold' modality rubric with zero connection to skin/scalp."
  },
  {
    name: "Belladonna sudden high fever — flushed face, throbbing headache, photophobia, thirstless",
    text: "I've had a fever for two days, doctor, and it came on very fast, right after I got caught in that cold wind storm last week. My face went bright red and hot suddenly, and I've got this pounding headache, feels like my head is going to burst with every heartbeat almost. Loud sounds and even normal light bother me a lot right now. I haven't wanted to drink anything at all despite the fever, and I was a little confused talking to my wife last night, saying things that didn't fully make sense, but I wasn't trying to get out of bed or anything, just restless in place.",
    expectTopId: "bell"
  },
  {
    name: "Bryonia — bare 'worse with motion' modality phrasing",
    text: "back pain worse with motion",
    expectTopId: "bry",
    notes: "Confirms Modalities section isn't treated as wholesale-generic (only the curated thermal/time subset is)."
  },
  {
    name: "Chamomilla — teething, one-sided facial flush, green stools, worse at night",
    text: "My little one is 18 months, doctor, cutting his back teeth right now and its been a rough week. One side of his face is flushed red and hot, the other side stays pale, I've noticed that clearly. He's impossible to please, screams the second I set him down, wants to be carried constantly, and even then he's just whimpering, nothing seems to properly satisfy him. His stools have turned green, watery, and quite frequent. He seems worse at night, barely sleeps.",
    expectTopId: "cham",
    notes: "Fixed by adding dedicated repertory rubrics for the one-cheek-red/other-pale teething picture and for green watery stool — previously had zero repertory backing and lost to Acetic Acid on coincidental materia medica overlap."
  },
  {
    name: "Psorinum — extreme chilliness, offensive body odor, despair of recovery (bare symptom list, no narrative)",
    text: "Extremely chilly patient, cannot tolerate even slight cold. Sleeps with multiple blankets in summer. Offensive body odor. Feels hopeless, thinks recovery is impossible. Weak digestion. Anxiety about health but more despair than restlessness.",
    expectTopId: "psor",
    notes: "Fixed via a new 'offensive body odor' rubric plus loosening the nosode filter to allow a nosode through when it's the clear top scorer, not just when the text literally says 'chronic'."
  },
  {
    name: "Lycopodium — bloating, constipation, craves sweets, chilly, fear of failure",
    text: "Digestive complaints with bloating. Constipation. Craves sweets. Easily fatigued. Irritable at home. Chilly. Fear of failure.",
    expectTopId: "lyc",
    notes: "Fixed by adding lyc to the 'Constipation, general/unspecified' rubric."
  },
  {
    name: "Psorinum — post-typhoid exhaustion narrative, despair of ever recovering",
    text: "Doctor, I don't know how to explain this properly, but ever since I recovered from that bad case of typhoid two years ago, I've never really felt like myself again. I get exhausted so easily, and I feel cold all the time, even under two blankets in summer I still want more covering. My skin has these eruptions that come and go, and honestly they smell quite bad, but strangely it doesn't bother me much, my wife is the one who complains about it, not me. I eat a proper meal and an hour later I'm ravenous again, like I never ate at all. What worries me most is I've lost hope that I'll ever fully recover, I keep telling my wife I don't think I'll ever be well again, even though the doctors say my reports are fine now.",
    expectTopId: "psor",
    notes: "Fixed via CHRONICITY_DURATION_PATTERN ('two years ago') and a POST_ILLNESS_PATTERN check that stops 'recovered from typhoid X ago' from triggering the acute Typhoid disease-protocol boost toward Arsenicum."
  },
  {
    name: "Nux Vomica — business owner, coffee/wine, 3am waking with work worry, drowsy after lunch",
    text: "I run my own firm, doctor, and the last few months have been brutal on my body. I've been drinking more coffee than I should, a few glasses of wine most evenings just to unwind, and my stomach's paying for it, this constant heartburn that won't quit. My wife says I've become someone she doesn't recognize, snapping at the kids over the smallest things, at her, at everyone at the office too. I wake up like clockwork around 3 in the morning, mind immediately racing about work, and then I can't fall back asleep no matter what I try. After lunch though I get so drowsy I could put my head down on my desk. I'm chilly most of the time, and my bowels have been irregular, mostly stuck.",
    expectTopId: "nux-v",
    notes: "Fixed by adding three genuinely-documented Boericke keynotes/rubrics: 3am waking with business worry, drowsy after meals, desire for coffee/wine/stimulants."
  },
  {
    name: "Helleborus — sudden stupor fever in a child, staring, boring head into pillow, limp when lifted",
    text: "My daughter is six, doctor, and this fever came on so fast yesterday, she went from playing normally to completely different within hours. She's just staring blankly now, doesn't really respond when I call her name, takes a while before she even seems to hear me. She keeps twisting her head into the pillow, back and forth, back and forth, like she's trying to bore a hole into it. When I try to pick her up she doesn't cry or resist, she's just limp and dull, not herself at all. Her hand keeps reaching down toward her private parts too, which is strange, she's never done that before. It's frightening how unresponsive she's become so quickly.",
    expectTopId: "hell",
    notes: "Fixed by adding a repertory rubric for the sudden-stupor/boring-head-into-pillow picture — previously had zero repertory backing and lost to Hepar Sulph via a spurious 'quickly'~'quick to anger' word-prefix collision."
  },
  {
    name: "Pulsatilla — recurrent ear infection, clingy, thirstless with fever, better open air worse warm room",
    text: "My little girl keeps getting these ear infections, doctor, this is the third one this year alone. Right now there's this thick yellowish discharge coming from her ear, doesn't smell too bad thankfully. She's been so clingy the last two days, doesn't want anyone but me holding her, starts crying the second I set her down even for a minute. What's odd is she barely wants to drink anything even with the fever, usually she's asking for water all day. She feels better in the evening when we take her out for some air, but the moment we're back in a warm closed room she gets fussy again. Her mood just swings so fast too, giggling one minute, in tears the next.",
    expectTopId: "puls",
    notes: "Fixed by broadening the thirstless-with-fever trigger phrasing and adding a dedicated 'better open air, worse warm closed room' rubric — previously lost to Chamomilla on a shared clingy/carried rubric skewed 3:1 in Chamomilla's favor."
  },
  {
    name: "Carbo Vegetabilis — collapse after food poisoning, wants to be fanned, cold extremities but wants window open",
    text: "I had a bad bout of food poisoning last week, doctor, and even though the vomiting and diarrhea have stopped, I still feel absolutely wrung out, like my body just gave up. I feel so bloated, all this gas sitting in my stomach that won't move, and honestly the only thing that gives me any relief is if my son sits next to me with a hand fan going, I know it sounds silly but moving air across my face and chest actually helps. My hands and feet stay cold no matter what, but I still want the window open, I can't stand a stuffy room right now. I feel weak, sluggish, like my whole system has slowed right down.",
    expectTopId: "carb-v",
    notes: "Fixed by adding dedicated 'wants to be fanned/air hunger' and 'collapse after acute illness' rubrics — 'fan'/'fanned' is too short a word for the fuzzy word-matcher's prefix rule to ever catch on its own."
  },
  {
    name: "Sulphur — itchy skin worse heat, philosophical/untidy, urgent hunger if meal delayed (narrative phrasing)",
    text: "I've had this itchy skin thing for years, doctor, comes and goes, never fully leaves. It's so much worse after a hot shower, or if I get too warm under the blankets at night, but stepping out into cool air actually calms it right down. I'll be honest with you, I love a good debate, my wife says I could argue philosophy or politics for hours with anyone who'll listen, I just find ideas fascinating. My study at home is an absolute mess, papers everywhere, and it doesn't bother me one bit, though it drives her up the wall. Around eleven every morning, without fail, I get this urgent hunger, if I don't eat something right then I turn shaky and short-tempered. My ears and lips tend to look redder than everyone else's too.",
    expectTopId: "sulph",
    notes: "Fixed a false-negation bug: the idiom 'without fail' was being read as negating 'urgent hunger' right after it, silently blocking Sulphur's own hunger rubric from firing."
  },
  {
    name: "Cina — furious if touched, calmed only by vigorous rocking, nose-picking till it bleeds",
    text: "My son's been so difficult lately, doctor, and it's strange because it's not like his usual naughtiness. He gets furious if anyone even looks at him directly, let alone touches him, he'll actually hit out if you try. He grinds his teeth so loudly at night I can hear it from the next room, and he keeps picking at his nose constantly, almost till it bleeds sometimes. He's hungry again barely an hour after a full meal, eats like he's starving even though he just ate plenty. Oddly, the only thing that seems to calm him down at all is if I rock him firmly, not gently, quite a vigorous rocking, gentle rocking doesn't work at all, it has to be firm.",
    expectTopId: "cina",
    notes: "Fixed by adding a dedicated repertory rubric for the furious-if-touched/vigorous-rocking/nose-picking picture — previously had zero repertory backing."
  }
];

const KNOWN_ISSUES = [
  {
    name: "Argentum Nitricum — anticipatory school anxiety with 'loose motions'",
    text: "My son is 7, doctor, and he's been so anxious about school ever since he had to give a class presentation last month. Now every school morning he complains of loose motions, right before we leave the house, like clockwork. He's normally quite meticulous, likes his books arranged just so, gets upset if his schedule changes suddenly. He also mentioned his hands shake a little when he's nervous. He does say he feels a bit better once we're outside walking to school, in the open air.",
    expectTopId: "arg-n",
    notes: "Data has the exact right keynotes but 'loose motions'≠'diarrhea' and 'anxious'≠'anxiety' — vocabulary/synonym gap, not yet fixed."
  },
  {
    name: "Rhus Tox — chronic joint pain, morning stiffness better with continued motion",
    text: "I'm 62, doctor, and for the last year my knees and hips ache, worse than anything first thing in the morning, I can barely get out of bed without help. But once I've been up and about for half an hour or so it does ease up quite a bit. Cold, rainy weather is the worst for me, I can predict rain before the weather report can. A hot water bottle on the joints helps a lot. I also toss and turn at night, can't get comfortable in one position for long.",
    expectTopId: "rhus-t",
    notes: "Repertory trigger phrases for this rubric are too rigid for natural narrative phrasing."
  },
  {
    name: "Mercurius Solubilis — recurrent tonsillitis, offensive breath, drooling, thirstless",
    text: "My daughter is 4, doctor, and her tonsils have been swelling up again and again, third time this year. Right now her throat's quite red and swollen, more on the right side, and her breath actually smells bad, quite offensive. She's drooling more than usual too, more saliva than normal for her age. She doesn't seem to want much water despite the fever. She's sweaty most of the time, and the sweat has an odor too, doesn't dry off her easily.",
    expectTopId: "merc-sol",
    notes: "Not yet diagnosed in depth."
  },
  {
    name: "Apis Mellifica — hives, worse warm bed, better cold compress, lip swelling",
    text: "I get these hives, doctor, they come up suddenly, big red welts, and they itch so much its unbearable, especially at night in bed when I'm warm under the blanket. Cool air or a cold compress actually calms it down quite a bit. It seems to happen more after I eat shellfish, though not every single time. My lips have swollen up once too, gave me a scare. Otherwise I feel quite anxious and restless when it flares up badly.",
    expectTopId: "apis",
    notes: "Vocabulary gap: warm/heat, cool/cold, swollen/swelling, hives/'allergic reaction' are treated as different words."
  },
  {
    name: "Natrum Muriaticum — grief, avoids being hugged, doesn't discuss feelings (different phrasing than the passing grief case)",
    text: "I haven't been myself since my husband passed away eight months ago, doctor. I just keep myself busy, work, chores, I don't like sitting and talking about my feelings, it makes me uncomfortable, I'd rather be alone with it. When my daughter tries to hug me I sort of stiffen up, I don't mean to but I do. I've lost some weight too, I just don't feel like eating much. I crave salty things though, chips, papad, that sort of thing. My headaches come almost daily now, and lying down in a quiet dark room with some pressure on my forehead is the only thing that helps.",
    expectTopId: "nat-mur",
    notes: "The grief/consolation triggers added today were tuned to a different case's phrasing; this one's 'stiffen up at a hug' language isn't covered yet."
  }
];

function runRegressionTests() {
  if (typeof DB === "undefined" || !DB || !DB.remedies) {
    return { error: "DB not loaded yet — call runRegressionTests() after the page has finished loading remedies.json/repertory.json." };
  }
  ensureMaxScores();

  function runOne(c) {
    const dp = detectDiseaseProtocol(c.text);
    const results = scoreRemedies(c.text, dp);
    const top = results[0];
    const top3 = results.slice(0, 3).map(r => r.remedy.id);
    let pass, detail;
    if (c.mustNotBeTop) {
      pass = !top || top.remedy.id !== c.mustNotBeTop;
      detail = "top: " + (top ? top.remedy.name + " (" + top.percent + "%)" : "none") + (pass ? "" : "  <-- FAIL, must not be " + c.mustNotBeTop);
    } else {
      pass = !!top && top.remedy.id === c.expectTopId;
      detail = "top: " + (top ? top.remedy.name + " (" + top.percent + "%)" : "none") + (pass ? "" : "  <-- FAIL, expected " + c.expectTopId);
    }
    return { name: c.name, pass, detail, top3 };
  }

  const passingResults = PASSING_CASES.map(runOne);
  const knownIssueResults = KNOWN_ISSUES.map(runOne);
  const failures = passingResults.filter(r => !r.pass);

  return {
    summary: failures.length === 0
      ? "ALL " + passingResults.length + " REGRESSION CASES PASS"
      : failures.length + " OF " + passingResults.length + " REGRESSION CASES FAILED — investigate before shipping",
    failures,
    passingResults,
    knownIssueResults
  };
}

if (typeof window !== "undefined") window.runRegressionTests = runRegressionTests;
