// Problems in Agent Calling - source data.
// Built from tring-tring-problems-styled.xlsx (Downloads) plus the recordings in the
// Drive "7x weddings" folder, all copied into audio/ so they play on the page.
//
// Each problem has a `proof` list. An entry can be:
//   "audio/file.wav"                          -> in-page audio player
//   "audio/shot.png"                          -> image proof (click to open full size)
//   { file: "audio/x.wav", name: "label" }    -> same, with a custom label
//   { text: "..." , name: "label" }           -> quoted transcript / text proof
//   { link: "https://...", name: "label" }    -> plain link (e.g. the Drive folder)
//   { note: "..." }                           -> small note shown in the proof box
//   a Google Drive share link                 -> embedded Drive player
window.SECTIONS = [
  {
    key: "agent",
    title: "Agent Calling Problems",
    subtitle: "Issues observed during call testing.",
    problems: [
      { id: 1, title: "Hello/Hello Spam",
        problem: "The system is unable to properly process repeated \"Hello\" messages from the caller.",
        expectation: "The system should detect repeated greetings and respond appropriately without getting stuck.",
        proof: [
          { file: "audio/01-hello-hello-spam.wav", name: "Hello-hello spam" },
          { file: "audio/01b-hello-hello-spam-iphone-fine.wav", name: "Hello-hello spam (iPhone works fine)" }
        ] },
      { id: 2, title: "Automatic Language Detection",
        problem: "The system does not automatically adjust to the user's language.",
        expectation: "The system should automatically detect the user's language and continue the conversation in the same language without repeatedly asking the user.",
        proof: [
          { note: "The Drive link given for this row is the same recording as problem 8 (identical file). Listen for the language handling in it." },
          { file: "audio/08-got-interrupted-and-callback-request.wav", name: "Language issue / got interrupted" }
        ] },
      { id: 3, title: "Excessive Hello-to-Hello Time",
        problem: "Too much time is wasted during the initial \"Hello-Hello\" interaction.",
        expectation: "The system should minimize unnecessary greeting time and proceed with the conversation quickly.",
        proof: [
          { note: "Same recording as problem 1 – listen to the opening." },
          { file: "audio/01-hello-hello-spam.wav", name: "Hello-hello spam" }
        ] },
      { id: 4, title: "Audio Recording Failure",
        problem: "Audio recordings sometimes become corrupted or fail.",
        expectation: "Audio should be recorded reliably without corruption or missing recordings.",
        proof: [ { file: "audio/04-audio-not-getting-recorded.wav", name: "Audio not getting recorded" } ] },
      { id: 5, title: "Call Log Filtering",
        problem: "Call logs need better filtering options.",
        expectation: "Call logs should be filterable by call duration.",
        proof: [] },
      { id: 6, title: "Background Noise / Poor Audio Quality",
        problem: "When there is significant background noise, the system may not clearly understand the caller and may make random guesses.",
        expectation: "The system should detect poor audio quality and ask the caller to repeat instead of guessing.",
        proof: [
          { file: "audio/06-bg-noise.wav", name: "Background noise" },
          { note: "More examples are in the shared recordings folder." },
          { link: "https://drive.google.com/drive/folders/1jnj7WLzdtdfkmq_iuV1YYBzQ4BzRzquT", name: "Open the recordings folder" }
        ] },
      { id: 7, title: "Delayed Response",
        problem: "The system sometimes takes around 10 seconds to respond, causing the caller to repeatedly say \"Hello\".",
        expectation: "Response latency should be reduced. The system should respond within an acceptable time.",
        proof: [ { file: "audio/07-takes-much-time-to-respond.wav", name: "Takes much time to respond" } ] },
      { id: 8, title: "Caller Interruptions",
        problem: "The system may get cut off or fail when the caller speaks in between the system's response.",
        expectation: "The system should properly handle interruptions (barge-in) and continue the conversation naturally.",
        proof: [ { file: "audio/08-got-interrupted-and-callback-request.wav", name: "Got interrupted, caller asks for call back" } ] },
      { id: 9, title: "Improper Response Timing",
        problem: "The response timing is not always appropriate. For example, when the user says \"Hunn bolo\", the system may not respond.",
        expectation: "The system should correctly detect when the caller has finished speaking and respond accordingly.",
        proof: [ { file: "audio/09-improper-response-timing.wav", name: "Improper response timing" } ] },
      { id: 11, title: "Accent-Related Misinterpretation",
        problem: "The system sometimes misinterprets words because of the caller's accent. Example: \"Yeah\" being interpreted as \"Kya\".",
        expectation: "Improve speech recognition and accent handling to reduce incorrect interpretations.",
        proof: [
          { file: "audio/11-yeah-kya-misinterpretation.png", name: "\"Yeah\" heard as \"Kya\" (screenshot)" },
          { file: "audio/11b-misinterpretation-and-callback-request.wav", name: "Misinterpretation, caller asks for call back" }
        ] },
      { id: 12, title: "Gender / Basic Information Mismatch",
        problem: "There is a gender mismatch and the system does not have/use basic contextual information such as location, food availability, etc.",
        expectation: "The system should use correct user/context information and provide relevant basic information.",
        proof: [ { file: "audio/12-gender-mismatch.wav", name: "Gender mismatch" } ] },
      { id: 13, title: "Noise Affecting Sound Quality",
        problem: "Noise significantly affects the overall sound quality and conversation experience.",
        expectation: "Improve noise handling and voice processing so that the conversation remains clear in noisy environments.",
        proof: [ { file: "audio/13-audio-quality-poor.wav", name: "Audio quality poor" } ] },
      { id: 14, title: "Call Not Ending Without Response",
        problem: "The call does not automatically end even when there is no response from the caller.",
        expectation: "Implement a timeout mechanism. If the caller does not respond after a defined period, the system should appropriately end or handle the call.",
        proof: [ { file: "audio/14-call-not-ending.wav", name: "Call not ending" } ] },
      { id: 16, title: "Improper Transcript",
        problem: "The system recorded weird transcripts in a few recorded calls.",
        expectation: "The transcripts should be proper.",
        proof: [
          { text: "GvoxAi: response:record_outcome{result:{instruction:Outcome recorded for this call.,successI apologize for that. We're looking forward to seeing you there! Goodbye.", name: "Transcript excerpt" },
          { file: "audio/16-not-proper-transcript.wav", name: "Not proper transcript" }
        ] },
      { id: 17, title: "Number Recognition from Accent",
        problem: "The system is unable to correctly translate/recognize numbers because of accents. Example: 328 to 314 is being interpreted as 3282314.",
        expectation: "Improve number recognition, especially for different accents and pronunciations.",
        proof: [ { file: "audio/17-number-issue.wav", name: "Number issue" } ] }
    ]
  },
  {
    key: "telenow",
    title: "Telenow Problems",
    subtitle: "Issues that should not happen at all – the expected behaviour is already defined in the prompt.",
    problems: [
      { id: 1, title: "Interrupted During Greeting",
        problem: "The agent got interrupted in the greeting itself, even though handling for this is already defined in the prompt.",
        expectation: "The greeting should complete as defined in the prompt and not be cut off by the caller speaking.",
        proof: [ { file: "audio/t01-got-interrupted-in-greeting.wav", name: "Got interrupted in greeting" } ] },
      { id: 2, title: "Expected Question Missing",
        problem: "The agent skipped an important question during the call, even though the prompt specifies that all of these questions must be asked.",
        expectation: "Every question specified in the prompt should be asked on every call, with none skipped.",
        proof: [ { file: "audio/t02-expected-question-missing.wav", name: "Expected question missing" } ] },
      { id: 3, title: "Setup Is Too Complicated",
        problem: "The setup is very complicated and frustrating. There are too many functions and settings to go through, so a user with no technical knowledge will give up and quit after a day.",
        expectation: "Setup should be simple enough that a non-technical user can get started without help. There is no recording for this one – it is only understood by using the product.",
        proof: [] },
      { id: 4, title: "Bulk Download of Call Recordings",
        problem: "There is no option to download all call recordings in one go. Downloaded files are named only with a timestamp and a random ID (for example 2026-10-14_12-31-46Z_f468f5af...), so once they are on the computer there is no way to tell which recording belongs to which call or customer.",
        expectation: "Add a bulk download option for call recordings, and let the user choose the file naming pattern (for example name_number or name_date) instead of the random ID, so every file can be identified at a glance.",
        proof: [ { file: "audio/t04-recording-filenames.png", name: "Downloaded recordings – timestamp and random ID only" } ] },
      { id: 5, title: "Excel Sheet Setup and Mapping Is Hard",
        problem: "Setting up the Excel sheet is a difficult task for the user. Mapping the columns takes a lot of time and effort before calling can even start.",
        expectation: "The software should handle the Excel setup itself. The user should be able to upload a blank or plain Excel sheet and the system should set up the columns and mapping for them, without the user spending time on configuration.",
        proof: [] },
      { id: 6, title: "Agent and Caller Split Into Left / Right Channels",
        problem: "Call recordings are saved in stereo with the agent's voice on one side and the caller's voice on the other. The recording sounds unnatural, like the two people are speaking from opposite ears.",
        expectation: "Recordings should sound like a normal phone call, with both voices mixed together in the centre, not panned left and right.",
        proof: [
          { note: "Listen with headphones – both Telenow recordings are stereo and one channel goes silent while the other person speaks." },
          { file: "audio/t01-got-interrupted-in-greeting.wav", name: "Agent on one side, caller on the other" },
          { file: "audio/t02-expected-question-missing.wav", name: "Same left / right split" }
        ] },
      { id: 7, title: "Name Misinterpreted in Transcript",
        problem: "The caller's name was transcribed as \"R.C Best\" instead of \"Aarti Bisht\". The agent then works with the wrong name for the rest of the call.",
        expectation: "Names should be captured correctly. The agent should use the name from the sheet / prompt, or confirm the spelling with the caller instead of guessing from the audio.",
        proof: [ { file: "audio/t07-name-misinterpreted.wav", name: "\"Aarti Bisht\" heard as \"R.C Best\"" } ] },
      { id: 8, title: "Campaign Not Writing Phone Numbers to the Sheet",
        problem: "During the campaign the call data was written to the Excel sheet without the phone number \u2013 the column stayed blank for most rows, so the results could not be matched back to a contact. It was only fixed after we raised a complaint. The same sheet also mixes two date formats in one column.",
        expectation: "Every completed call should write the full row to the sheet, including the phone number, in one consistent format. This should work out of the box \u2013 a customer should never have to raise a complaint to get basic data written correctly.",
        proof: [ { file: "audio/t08-campaign-sheet-missing-phone.png", name: "Campaign sheet \u2013 phone number column blank for most calls" } ] },
      { id: 9, title: "Live Call Listening Audio Is Choppy",
        problem: "The live listen-in audio during an ongoing call is very poor quality \u2013 it breaks up constantly and is hard to follow. Live audio cannot be downloaded, so there is no recording to attach; you have to listen in on a live call to hear it.",
        expectation: "Live call listening should be as clear as a normal phone conversation, with no breaking or dropouts.",
        proof: [] },
      { id: 10, title: "Call Recording Missing \u2013 Stuck on \"Processing\"",
        problem: "Some calls from the campaign have no recording at all. The call page has shown \"No recording for this call \u2013 the recording may still be processing, check back shortly\" for 3\u20134 days, since the day the campaign was run. The recording is clearly never going to appear.",
        expectation: "Every call must have its recording, no matter how the call went or how it ended. If a recording genuinely fails, the page should say so instead of showing \"processing\" forever.",
        proof: [ { file: "audio/t10-recording-missing-still-processing.png", name: "Call page still says \"may still be processing\" days later" } ] }
    ]
  },
  {
    key: "pramukh",
    title: "Pramukh Problems",
    subtitle: "Issues seen on the Pramukh calls.",
    problems: [
      { id: 1, title: "Agent Went Silent Mid-Call",
        problem: "The agent went completely quiet for about 5\u201310 seconds in the middle of the call. This should not happen. It was possibly triggered by background voices and noise on the caller's side confusing the agent.",
        expectation: "The agent should never go silent for that long. If background noise or voices make the input unclear, it should say so and ask the caller to repeat, or acknowledge that it is still there, instead of leaving dead air.",
        proof: [ { file: "audio/p01-ai-went-silent.wav", name: "AI went silent for 5\u201310 seconds" } ] },
      { id: 2, title: "Same Question Asked Three Times",
        problem: "The agent asked the same question three times in a row, even though the caller had already answered it the first time. This repetition needs to be fixed.",
        expectation: "Once the caller has answered a question, the agent should register the answer and move on. It should never re-ask a question that has already been answered.",
        proof: [ { file: "audio/p02-kept-asking-same-question.wav", name: "Kept asking the same question" } ] }
    ]
  }
];
