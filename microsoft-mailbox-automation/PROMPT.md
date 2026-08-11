# Master Development Prompt

============================================================
VOICE-FIRST MISSION EXECUTION
============================================================

Existing deployed route:

https://microsoft-mailbox-automation-one.vercel.app/voice-demo

Treat this route as an existing SPINOR/Advantage Foundry interface that
must be inspected, repaired where necessary, and integrated into the
production experiment loop.

Do not rebuild it as a disconnected demo.

Its production role is:

Daily Seed
→ spoken mission briefing
→ employee verbal observation
→ structured evidence extraction
→ human verification
→ immutable observation record
→ experiment and attribution update

------------------------------------------------------------
CORE EXPERIENCE
------------------------------------------------------------

The user should be able to complete a field research interaction without
typing.

Required sequence:

1. Load the user’s assigned Daily Seed.
2. Confirm that the mission is active and approved.
3. Read the mission aloud when speech synthesis is available.
4. Display the same mission in accessible text.
5. Explain:
   - the hypothesis;
   - permitted variables;
   - prohibited variables;
   - primary outcome;
   - evidence required;
   - compliance boundaries.
6. Ask one question at a time.
7. Capture the employee’s spoken response.
8. preserve the raw transcript;
9. extract structured observations;
10. distinguish facts, interpretations, estimates, and uncertainty;
11. show the extracted evidence for confirmation;
12. allow correction before submission;
13. append the accepted evidence to the experiment ledger;
14. update admissibility and attribution asynchronously;
15. generate the next research question when appropriate.

The voice experience must not silently treat a transcript as verified fact.

------------------------------------------------------------
SUPPORTED VOICE ACTIONS
------------------------------------------------------------

Implement voice equivalents for:

- Start mission
- Read hypothesis
- Explain assignment
- Review evidence
- Plant
- Observe
- Challenge
- Record deviation
- Add confounder
- Derive
- Request replication
- Pause
- Resume
- Correct transcript
- Confirm evidence
- Discard observation
- Finish session

Example commands:

“Read the hypothesis.”

“Why was I assigned this?”

“Record an observation.”

“The office manager completed the workflow.”

“Correction: it was the nurse coordinator.”

“Add a confounder.”

“The account had already received a separate reminder.”

“Mark that as uncertain.”

“Submit the observation.”

“Create a derivative that changes only the handoff timing.”

------------------------------------------------------------
BROWSER CAPABILITY DETECTION
------------------------------------------------------------

Do not assume speech recognition or speech synthesis exists.

Detect independently:

- microphone permission;
- speech-recognition support;
- speech-synthesis support;
- available voices;
- selected language;
- secure-context availability;
- current browser;
- mobile restrictions;
- audio-device availability.

Represent capability state explicitly:

- checking;
- supported;
- permission required;
- permission denied;
- unsupported;
- temporarily unavailable;
- recognition failed;
- audio device missing.

Never leave the page indefinitely displaying only “Checking.”

Apply a bounded capability-detection timeout.

After timeout, render the text-first fallback.

The application must remain fully usable without voice APIs.

Recommended hierarchy:

1. Native browser speech recognition and synthesis.
2. Configured server-side transcription or speech provider.
3. Audio recording with deferred transcription.
4. Text entry fallback.

Chrome or Edge may expose richer browser speech functionality, but the
application must not become unusable in Safari, Firefox, Opera, or a
browser where the APIs are disabled.

------------------------------------------------------------
MICROPHONE AND RECORDING CONSENT
------------------------------------------------------------

Before recording:

- clearly request microphone permission;
- explain what will be recorded;
- explain whether audio is stored;
- explain whether transcription is performed locally or remotely;
- identify the organization receiving the evidence;
- show the applicable retention policy;
- require an explicit Start Recording action.

Display a persistent recording indicator.

Provide:

- Pause;
- Stop;
- Delete;
- Review;
- Submit.

Never start microphone capture automatically when the page loads.

Never record background conversations without a deliberate active
session.

Do not infer consent from navigation to the page.

------------------------------------------------------------
SESSION STATE MACHINE
------------------------------------------------------------

Implement an explicit state machine:

idle
→ capability_check
→ permission_request
→ ready
→ briefing
→ listening
→ processing
→ review
→ confirmed
→ persisted
→ completed

Additional states:

paused
permission_denied
unsupported
transcription_failed
validation_failed
compliance_hold
network_interrupted
expired_mission
cancelled

Every transition must be deterministic and testable.

Prevent double submission.

Persist recoverable session progress locally when appropriate.

Do not persist sensitive raw audio in general browser storage.

------------------------------------------------------------
TRANSCRIPT MODEL
------------------------------------------------------------

Store transcript segments with:

- segment ID;
- session ID;
- experiment ID;
- speaker;
- start time;
- end time;
- transcript text;
- confidence;
- recognition provider;
- language;
- correction history;
- confirmation state;
- source audio reference where permitted;
- redaction state;
- created timestamp.

Never overwrite corrected transcript text.

Preserve:

- original recognition;
- corrected version;
- correcting user;
- timestamp;
- reason where supplied.

------------------------------------------------------------
EVIDENCE EXTRACTION
------------------------------------------------------------

Convert transcript content into proposed structured artifacts.

Supported artifact types:

- observation;
- outcome;
- protocol deviation;
- confounder;
- customer preference signal;
- execution-fidelity event;
- negative outcome;
- complaint;
- opt-out;
- adverse-event indicator;
- follow-up requirement;
- derivative idea;
- unresolved question;
- external-factor report.

Each extraction must contain:

- artifact type;
- source transcript segment IDs;
- exact supporting excerpt;
- normalized statement;
- account or cohort reference;
- experiment reference;
- event time;
- confidence;
- uncertainty;
- evidence status;
- required review;
- compliance flags;
- human-confirmation state.

The LLM must not generate evidence unsupported by the transcript.

Every extracted field must retain source-span provenance.

------------------------------------------------------------
FACT VERSUS INTERPRETATION
------------------------------------------------------------

Classify each spoken statement as one of:

- directly observed fact;
- customer-reported statement;
- employee interpretation;
- estimate;
- prediction;
- causal claim;
- preference inference;
- unresolved uncertainty.

Example:

Spoken:

“The doctor ignored the workflow because he hates technology.”

Do not store this as fact.

Extract:

Observed fact:
No workflow completion was recorded during the observation window.

Employee interpretation:
The employee believes technology aversion may explain noncompletion.

Confidence:
Low.

Alternative explanations:
Timing, staff ownership, competing priorities, access failure, or an
unrecorded interaction.

Require confirmation before persistence.

------------------------------------------------------------
GUIDED SCIENTIFIC INTERVIEW
------------------------------------------------------------

The voice agent must conduct a short structured interview rather than
merely transcribe free speech.

Recommended prompts:

“What happened?”

“What did you directly observe?”

“What changed from the approved protocol?”

“Who performed the action?”

“When did it occur?”

“What outcome was recorded?”

“What evidence supports that conclusion?”

“What else could explain the result?”

“Was there any complaint, opt-out, safety issue, or unexpected event?”

“How confident are you?”

“Should this become an observation, challenge, deviation, or derivative?”

Ask only questions relevant to the active experiment.

Avoid interrogation fatigue.

Allow the employee to say:

“Skip.”

“I don’t know.”

“Not observed.”

“Mark uncertain.”

------------------------------------------------------------
MISSION BRIEFING
------------------------------------------------------------

The spoken briefing must be concise.

Default voice briefing:

- mission name;
- hypothesis;
- target population;
- permitted action;
- comparison;
- primary outcome;
- fixed variables;
- major compliance restriction;
- completion condition.

Provide deeper explanation only on request.

Do not read long prior-art reports or policy documents aloud by default.

Offer:

“Would you like the evidence summary, assignment reason, or experiment
instructions?”

------------------------------------------------------------
PHARMA-SPECIFIC CONTAINMENT
------------------------------------------------------------

Voice interaction must not become an uncontrolled promotional-content
generator.

The system may help record:

- operational observations;
- approved-content delivery;
- timing;
- channel;
- workflow completion;
- stakeholder sequence;
- account-service activity;
- administrative barriers;
- representative effort;
- compliance events.

The voice agent must not autonomously create:

- new clinical claims;
- modified efficacy claims;
- comparative claims;
- off-label recommendations;
- altered safety statements;
- prescribing recommendations;
- patient-specific targeting instructions.

Detect potential adverse-event statements.

When detected:

1. Preserve the source transcript.
2. Mark the session for required review.
3. Display the organization’s configured escalation procedure.
4. Prevent the event from being treated merely as experiment telemetry.
5. Record an immutable escalation receipt.
6. Do not claim the system itself completed regulatory reporting unless
   the configured reporting workflow actually confirms completion.

Detect potential product complaints separately.

------------------------------------------------------------
HUMAN CONFIRMATION
------------------------------------------------------------

Before evidence submission, present:

- transcript;
- extracted artifacts;
- linked account;
- linked experiment;
- observation time;
- certainty;
- compliance flags.

Allow the user to:

- edit;
- correct;
- split;
- merge;
- reclassify;
- delete;
- mark uncertain;
- submit.

Require an explicit confirmation action.

Recommended confirmation language:

“I confirm that this record accurately represents what I observed.”

Store confirmation identity and timestamp.

------------------------------------------------------------
VOICE OUTPUT
------------------------------------------------------------

Use text-to-speech only for:

- mission briefing;
- short questions;
- confirmation;
- errors requiring immediate attention;
- completion summary.

Do not speak sensitive mailbox content in an uncontrolled environment
without user initiation.

Provide:

- mute;
- replay;
- speaking-rate control;
- voice selection;
- captions;
- reduced-audio mode.

Stop speech immediately when:

- the user begins speaking;
- the session is paused;
- the page loses authorization;
- the user presses Stop;
- a compliance block occurs.

------------------------------------------------------------
NOISE AND FAILURE HANDLING
------------------------------------------------------------

Handle:

- silence;
- partial speech;
- repeated speech;
- background noise;
- low-confidence recognition;
- disconnected microphone;
- network interruption;
- provider timeout;
- language mismatch;
- accidental long recordings.

When recognition confidence is low:

- show the uncertain words;
- ask for correction;
- do not invent a clean transcript;
- do not automatically submit.

Provide a maximum recording duration and warning.

Support resumable chunked upload where server transcription is used.

------------------------------------------------------------
INTEGRATION CONTRACT
------------------------------------------------------------

The voice interface must integrate with:

- Daily Seed service;
- Advantage Foundry assignment service;
- Experiment service;
- Evidence ledger;
- Attribution Oracle;
- Admissibility Engine;
- Compliance service;
- Contribution ledger;
- notification system.

Suggested endpoints:

GET  /api/voice/capabilities
POST /api/voice/sessions
GET  /api/voice/sessions/:id
POST /api/voice/sessions/:id/transcript-segments
POST /api/voice/sessions/:id/extract
POST /api/voice/sessions/:id/confirm
POST /api/voice/sessions/:id/complete
POST /api/voice/sessions/:id/cancel
POST /api/voice/sessions/:id/audio
GET  /api/voice/sessions/:id/artifacts

Suggested session creation input:

{
  "organizationId": "...",
  "userId": "...",
  "dailySeedId": "...",
  "experimentId": "...",
  "language": "en-US",
  "captureMode": "browser_recognition",
  "audioRetention": "none"
}

Suggested output:

{
  "sessionId": "...",
  "state": "ready",
  "mission": {...},
  "capabilities": {...},
  "complianceRequirements": [...],
  "expiresAt": "..."
}

Do not trust client-submitted organization or user identity.

Resolve identity from the authenticated session.

------------------------------------------------------------
AUDITABILITY
------------------------------------------------------------

Create immutable events for:

- voice.session_created;
- voice.permission_requested;
- voice.recording_started;
- voice.recording_paused;
- voice.recording_stopped;
- voice.transcript_received;
- voice.transcript_corrected;
- voice.artifacts_extracted;
- voice.artifacts_confirmed;
- voice.compliance_flagged;
- voice.session_completed;
- voice.session_cancelled.

Store:

- session ID;
- authenticated actor;
- experiment;
- mission version;
- provider;
- language;
- hashes of relevant artifacts;
- timestamps;
- correction history;
- confirmation state;
- compliance result.

Avoid storing raw audio unless it is explicitly enabled and justified.

------------------------------------------------------------
ACCESSIBILITY
------------------------------------------------------------

Voice must enhance accessibility, not replace it.

Provide:

- full keyboard operation;
- textual controls;
- live captions;
- transcript review;
- clear recording state;
- screen-reader announcements;
- visible focus;
- high contrast;
- reduced-motion support;
- no voice-only required step.

------------------------------------------------------------
TESTING
------------------------------------------------------------

Add unit tests for:

- capability detection;
- session transitions;
- transcript correction;
- evidence extraction validation;
- source-span provenance;
- low-confidence handling;
- adverse-event flagging;
- duplicate submission prevention;
- permission-denied fallback.

Add integration tests for:

- Daily Seed to voice session;
- voice observation to experiment evidence;
- transcript correction to immutable history;
- confirmed artifact to admissibility update;
- compliance flag to escalation record;
- network interruption and recovery.

Add end-to-end tests:

1. User opens /voice-demo.
2. Capability check resolves within the timeout.
3. User grants microphone permission.
4. Mission is displayed and read aloud.
5. User records an observation.
6. The transcript appears.
7. Structured evidence is extracted.
8. The user corrects a recognition error.
9. The original transcript remains preserved.
10. The user marks one causal interpretation as uncertain.
11. The user confirms the evidence.
12. The observation appears in the experiment ledger.
13. Attribution and admissibility enter pending state.
14. Session completes with an audit receipt.

Also test:

- unsupported browser;
- denied microphone permission;
- text-only fallback;
- speech synthesis unavailable;
- low-confidence transcript;
- silence;
- background interruption;
- expired mission;
- compliance block;
- mobile layout.

------------------------------------------------------------
VOICE DEFINITION OF DONE
------------------------------------------------------------

The voice development is complete only when:

- /voice-demo resolves to a functional application route.
- Capability checking cannot remain stuck indefinitely.
- Text fallback works in every supported browser.
- Microphone capture requires explicit permission and action.
- Missions are loaded from real assigned Daily Seeds.
- Speech output can be interrupted.
- Transcripts are reviewable and correctable.
- Original and corrected transcript versions are retained.
- Evidence extraction is grounded in transcript spans.
- Facts and interpretations remain distinct.
- Submission requires human confirmation.
- Confirmed evidence enters the real experiment ledger.
- Compliance flags trigger governed workflows.
- Voice events produce audit receipts.
- No fake evidence or unlabeled demo metrics appear in production mode.
- The critical voice flow has automated tests.

============================================================
CURRENT FAILURE BOUNDARY
============================================================

This route is the voice-first execution surface for Advantage Foundry/SPINOR. The deployed page says it will generate a mission, read it aloud, accept spoken observations, and automatically capture the resulting evidence artifacts. In the current browser environment, it reports that speech synthesis and recognition are unavailable and recommends Chrome or Edge for full functionality. ([Advantage Foundry][1])

The route is reachable, but the visible application currently depends on browser-native voice capabilities and presents an unsupported warning where those capabilities are absent. The page also exposes only a single **Start Voice Demo** entry point in its publicly readable state; that does not prove that mission generation, recording, transcription, extraction, persistence, attribution, or compliance escalation are connected end to end. ([Advantage Foundry][1])

The most important correction is therefore:

> **Do not treat speech recognition as the product. Treat voice as an input adapter into the same versioned evidence, experiment, admissibility, attribution, and compliance system used by every other SPINOR interface.**

[1]: https://microsoft-mailbox-automation-one.vercel.app/voice-demo "Advantage Foundry — Where hypotheses grow into edge"
