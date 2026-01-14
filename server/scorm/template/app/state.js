// app/state.js

// App state
var state = {
  phase: 'start',
  currentIndex: 0,
  answers: {},
  variant: null,
  flatQuestions: [],
  shuffleMappings: {},
  matchingPools: {},
  timerInterval: null,
  remainingSeconds: null,
  timeExpired: false,
  submitted: false,
  answerConfirmed: false,
  feedbackShown: false,
  attemptSavedForThisSession: false,
  
  // Adaptive mode state
  adaptiveState: null, // Will be initialized for adaptive tests
};

// SCORM finish guard
var scormFinished = false;
