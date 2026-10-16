import type { FormDefinition } from './types';

/* ---------------------------------------------------------------------------
   SAMPLE FORM — apply for help with your council tax

   A demonstration form written for the hackathon, modelled on the kind of
   Council Tax Reduction / Council Tax Support form Greater Manchester
   councils publish. It is NOT any real council's form.

   Note what this form deliberately does NOT do: it never tells the resident
   whether they qualify, or how much they might get. Council Tax Reduction
   schemes are set locally and the rules differ between the ten boroughs. A
   tool that guessed would be wrong often, and being wrong about money people
   are counting on does real harm. We help them apply; the council decides.

   Maps to the GM Strategy workstream "Everyday support in every
   neighbourhood".
   --------------------------------------------------------------------------- */

export const councilTaxReduction: FormDefinition = {
  id: 'council-tax-reduction',
  title: 'Apply for help with your council tax',
  summary:
    'Council Tax Reduction can cut your bill if you are on a low income or claiming benefits. This walks you through what the application asks for.',
  provider: 'Your local council',
  officialUrl: null,
  estimatedMinutes: 12,

  evidenceUpfront: [
    'Your council tax account number — it is on your bill, usually top right',
    'Your National Insurance number (we will not ask you to type it here)',
    'Proof of what you earn: recent payslips, or a benefit award letter',
    'Rough amounts for any savings you have',
    'Details of anyone else aged 18 or over living with you',
  ],

  eligibilityNote:
    'Every council in Greater Manchester sets its own scheme, so the rules where you live may differ from a neighbouring borough. This tool cannot tell you whether you qualify or how much you would get — only your council can. It is still worth applying if your income is low.',

  questions: [
    {
      id: 'situation',
      label: 'Which of these best describes you right now?',
      help: 'Pick the closest. You can explain more later.',
      type: 'choice',
      required: true,
      options: [
        { value: 'working-low', label: 'I am working but my income is low' },
        { value: 'not-working', label: 'I am not working at the moment' },
        {
          value: 'unable-to-work',
          label: 'I am not able to work right now',
        },
        { value: 'pension', label: 'I am over State Pension age' },
        { value: 'student', label: 'I am a student' },
        { value: 'other', label: 'None of these quite fit' },
      ],
      why: 'This changes which scheme applies to you and which questions the council will ask next. Pension-age applications follow different national rules.',
    },

    {
      id: 'account_number',
      label: 'What is your council tax account number?',
      help: 'Look at your most recent council tax bill. It is usually at the top on the right, and is 8 or 9 digits. If you cannot find it, leave this blank and carry on.',
      type: 'text',
      required: false,
      placeholder: 'e.g. 12345678',
      why: 'It links your application to your bill. Without it the council can usually still find you from your address, but it takes longer.',
    },

    {
      id: 'address',
      label: 'What is your address?',
      help: 'The home the council tax bill is for, including the postcode.',
      type: 'longtext',
      required: true,
      placeholder: 'e.g. 14 Example Road, Stockport, SK1 1AA',
      why: 'Council Tax Reduction is run by whichever council covers your address, and the scheme differs between boroughs.',
      validation: [
        {
          kind: 'minLength',
          value: 10,
          message:
            'This looks a bit short. Please include the street and the postcode.',
        },
        {
          kind: 'postcode',
          message:
            'We could not spot a postcode. It decides which council handles your claim, so please add it if you can.',
        },
      ],
    },

    {
      id: 'moved_in',
      label: 'When did you move into this address?',
      help: 'A rough date is fine if you cannot remember exactly.',
      type: 'date',
      required: false,
      why: 'Reductions can sometimes be backdated to when you moved in or when your income changed, so the date can be worth money to you.',
      validation: [
        {
          kind: 'notFuture',
          message:
            'That date is in the future. If you are about to move, apply once you have moved in.',
        },
      ],
    },

    {
      id: 'benefits',
      label: 'Are you getting any of these?',
      help: 'Tick the closest. If you get more than one, pick Universal Credit if you get it.',
      type: 'choice',
      required: true,
      options: [
        { value: 'uc', label: 'Universal Credit' },
        { value: 'pension-credit', label: 'Pension Credit' },
        { value: 'jsa-esa', label: 'Jobseeker’s Allowance or Employment and Support Allowance' },
        { value: 'other-benefit', label: 'A different benefit' },
        { value: 'none', label: 'None of these' },
      ],
      why: 'If you already get certain benefits the council may already have your income details, which makes the application much shorter.',
    },

    {
      id: 'income_sources',
      label: 'Where does your money come from at the moment?',
      help: 'List everything, even small amounts — wages, benefits, a pension, money from family. You do not need exact figures here.',
      type: 'longtext',
      required: true,
      placeholder:
        'e.g. I work part time at a shop, about 20 hours a week. I also get Universal Credit.',
      why: 'The council works out your reduction from your total income. Leaving something out can mean an overpayment you have to pay back later.',
      validation: [
        {
          kind: 'minLength',
          value: 10,
          message:
            'Could you add a little more detail? Even a short sentence helps.',
        },
      ],
    },

    {
      id: 'household',
      label: 'Who else lives with you?',
      help: 'Include anyone aged 18 or over, and say if any of them are students, or if anyone pays you rent.',
      type: 'longtext',
      required: true,
      placeholder:
        'e.g. Just me and my two children, aged 7 and 10. Nobody else lives here.',
      why: 'Other adults in the home can change the amount — some reduce it, and some, like a full-time student or a carer, are ignored completely.',
      validation: [
        {
          kind: 'minLength',
          value: 4,
          message:
            'Please tell us who lives with you, or write "nobody" if you live alone.',
        },
      ],
    },

    {
      id: 'savings_band',
      label: 'Roughly how much do you have in savings?',
      help: 'A rough band is enough here. Include bank accounts and ISAs, not the home you live in.',
      type: 'choice',
      required: true,
      options: [
        { value: 'under-6k', label: 'Less than £6,000' },
        { value: '6k-16k', label: 'Between £6,000 and £16,000' },
        { value: 'over-16k', label: 'More than £16,000' },
        { value: 'unsure', label: 'I am not sure' },
      ],
      why: 'Most schemes take savings into account above a threshold. We ask for a band rather than an exact figure because the exact number belongs on the council’s own form, not here.',
    },

    {
      id: 'changes_coming',
      label: 'Is anything about your situation about to change?',
      help: 'For example a job starting or ending, someone moving in or out, or a benefit decision you are waiting on.',
      type: 'longtext',
      required: false,
      why: 'Telling them up front saves you having to report a change later, and avoids being paid too much and having to pay it back.',
    },

    {
      id: 'support_needs',
      label: 'Is there anything that would make this easier for you?',
      help: 'For example: a language other than English, help reading letters, a phone call instead of post, or more time.',
      type: 'longtext',
      required: false,
      why: 'Councils can provide interpreters, large print and help filling in forms. Most people are never asked, so they never find out.',
    },
  ],

  checks: [
    {
      id: 'savings-over-threshold',
      needs: ['savings_band'],
      kind: 'choiceRequiresText',
      when: { question: 'savings_band', equals: 'over-16k' },
      requires: 'income_sources',
      message:
        'With savings over £16,000 many schemes will not pay a reduction — but there are exceptions, for example if you get Pension Credit, and some boroughs set a different threshold. It is still worth applying and letting the council decide. Do not take this tool’s word for it.',
    },
    {
      id: 'moved-before-claim',
      needs: ['moved_in'],
      kind: 'advisory',
      message:
        'Check your move-in date is right. If you moved in a while ago and your income dropped since, ask the council about backdating — you may be owed money from an earlier date.',
    },
  ],

  nextSteps: [
    'Read back through your answers above and correct anything that looks wrong.',
    'Gather the documents listed — the application will ask you to upload or post them.',
    'Apply on your own council’s website, or ring them and read your summary out.',
    'Ask about backdating if your income dropped a while ago.',
    'If the decision seems wrong, you can ask for it to be looked at again. There is a time limit, so do it as soon as you can.',
    'For free, independent help with money and debt, Citizens Advice can go through this with you.',
  ],
};
