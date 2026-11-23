// What the Sharing section remembers for as long as the app runs (not saved): the HTTP warning for sharing that
// is already running shows once per app run, not every time Settings opens. Any other plain HTTP pop-up counts
// as that warning, so one that follows a choice made in the section does not repeat it.
const prompts = { runningWarningShown: false };

export const hasShownRunningWarning = () => prompts.runningWarningShown;
export const markRunningWarningShown = () => { prompts.runningWarningShown = true; };
export const resetSharingPromptsForTests = () => { prompts.runningWarningShown = false; };
