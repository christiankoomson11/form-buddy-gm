/* ---------------------------------------------------------------------------
   Form definition types
   ---------------------------------------------------------------------------

   The whole scaling argument rests on this file. A form is DATA, not code:
   a list of questions, the plain-English wording, why the council asks each
   one, what evidence it needs, and the rules for spotting an obvious mistake.

   Adding a form means writing one of these objects. It does not mean
   touching the engine, the UI or the prompts. That is what makes "ten
   boroughs, dozens of forms" a content job rather than an engineering job —
   and it means a council officer can review a form's wording without
   reading any TypeScript.

   These are plain objects by design, so they can move to JSON files, a CMS
   or a database later with no change to the engine.
   --------------------------------------------------------------------------- */

/** How the answer is captured. */
export type QuestionType =
  | 'text'
  | 'longtext'
  | 'choice'
  | 'date'
  | 'number';

/** One option in a choice question. */
export type ChoiceOption = {
  value: string;
  label: string;
  /** Optional plain-English clarification shown under the option. */
  hint?: string;
};

/* --- Validation ----------------------------------------------------------
   Rules are data, so they are auditable and translatable. The engine in
   lib/validate.ts interprets them. No rule may ever decide whether someone
   qualifies for something — these catch typos and gaps, nothing more.
   ------------------------------------------------------------------------ */

export type ValidationRule =
  | { kind: 'minLength'; value: number; message: string }
  | { kind: 'maxLength'; value: number; message: string }
  | { kind: 'pattern'; value: string; message: string }
  | { kind: 'postcode'; message: string }
  | { kind: 'notFuture'; message: string }
  | { kind: 'notBefore'; value: string; message: string }
  | { kind: 'min'; value: number; message: string }
  | { kind: 'max'; value: number; message: string };

/**
 * A check across two answers, run when the form is complete.
 * These produce a WARNING the resident can override, never a hard block —
 * the resident knows their own circumstances better than our rules do.
 */
export type ConsistencyCheck = {
  id: string;
  /** Question ids this check needs an answer for. */
  needs: string[];
  /**
   * dateOrder          — two dates are the wrong way round
   * choiceRequiresText — a given choice means another answer really matters
   * advisory           — no error, just something worth telling them once
   *                      every question in `needs` has been answered
   */
  kind: 'dateOrder' | 'choiceRequiresText' | 'advisory';
  /** For dateOrder: the earlier question id. */
  before?: string;
  /** For dateOrder: the later question id. */
  after?: string;
  /** For choiceRequiresText: the question and the value that demands detail. */
  when?: { question: string; equals: string };
  /** For choiceRequiresText: the question that must then be filled in. */
  requires?: string;
  message: string;
};

/* --- Questions ----------------------------------------------------------- */

export type Question = {
  id: string;

  /** The question in plain English. Aim for reading age 9. */
  label: string;

  /** Extra guidance, shown under the label. Optional. */
  help?: string;

  /**
   * Why the council asks this. Shown to the resident on request.
   * The brief's "locked doors" problem is partly a trust problem: people
   * abandon forms when they cannot see why personal information is wanted.
   */
  why?: string;

  type: QuestionType;

  /** Required for type 'choice'. */
  options?: ChoiceOption[];

  required: boolean;

  /** Documents or details the resident needs to hand to answer this. */
  evidence?: string[];

  /** Rules for catching an obvious mistake. */
  validation?: ValidationRule[];

  /**
   * Only ask this question when another answer matches.
   * Keeps the form short — the biggest single cause of drop-off.
   */
  showWhen?: { question: string; equals: string };

  /** Placeholder text for free-text inputs. */
  placeholder?: string;
};

/* --- The form ------------------------------------------------------------ */

export type FormDefinition = {
  id: string;

  /** The form's name, as a resident would recognise it. */
  title: string;

  /** One line on what the form is for. */
  summary: string;

  /** Who runs the real version of this form. */
  provider: string;

  /**
   * Where the real form lives. We never submit on the resident's behalf —
   * we hand them a summary and send them here, or to a person.
   */
  officialUrl: string | null;

  /** Rough time to complete, for setting expectations up front. */
  estimatedMinutes: number;

  /** What to gather before starting. Shown on the form's first screen. */
  evidenceUpfront: string[];

  /** Who this form is for and who it is not for. */
  eligibilityNote?: string;

  questions: Question[];

  checks?: ConsistencyCheck[];

  /** What happens after the resident has their summary. */
  nextSteps: string[];
};
