import type { FormDefinition } from './types';

/* ---------------------------------------------------------------------------
   SAMPLE FORM — report a repair in a rented home

   This is a demonstration form written for the hackathon. It is modelled on
   the kind of repair-reporting form Greater Manchester councils and social
   landlords publish, but it is NOT any real council's form and the wording
   has not been approved by anyone. Replace it with the real form's questions
   before this goes anywhere near a resident.

   Maps to the GM Strategy workstream "Healthy homes for all".
   --------------------------------------------------------------------------- */

export const housingRepair: FormDefinition = {
  id: 'housing-repair',
  title: 'Report a repair in your rented home',
  summary:
    'For council and housing association tenants who need something fixed — damp, heating, leaks, broken doors or windows.',
  provider: 'Your council or housing association',
  officialUrl: null,
  estimatedMinutes: 8,

  evidenceUpfront: [
    'Your address, including postcode',
    'Your tenancy or rent account number, if you can find it (you can still report a repair without it)',
    'A phone number or email address so they can arrange a visit',
    'Photos of the problem, if you can take them — these often get a repair booked faster',
  ],

  eligibilityNote:
    'This is for people who rent. If you own your home, your council will not repair it, but they may still be able to help with grants for heating or insulation.',

  questions: [
    {
      id: 'tenure',
      label: 'Who do you rent your home from?',
      type: 'choice',
      required: true,
      why: 'Different landlords fix different things, and this decides who your report goes to. If you pick a private landlord, we will point you to your rights instead.',
      options: [
        { value: 'council', label: 'The council' },
        {
          value: 'housing-association',
          label: 'A housing association',
          hint: 'Sometimes called a social landlord or a housing trust',
        },
        {
          value: 'private',
          label: 'A private landlord or letting agent',
          hint: 'Your council cannot do the repair, but it can take action against a landlord who will not',
        },
        { value: 'unsure', label: "I'm not sure" },
      ],
    },

    {
      id: 'address',
      label: 'What is the address of the home that needs the repair?',
      help: 'Include the house or flat number and the postcode.',
      type: 'longtext',
      required: true,
      placeholder: 'e.g. Flat 2, 14 Example Road, Manchester, M1 1AA',
      why: 'They need to know where to send someone. This is also how they find your tenancy on their system.',
      validation: [
        {
          kind: 'minLength',
          value: 10,
          message:
            'This looks a bit short for a full address. Please include the street and the postcode.',
        },
        {
          kind: 'postcode',
          message:
            "We could not find a postcode in there. A postcode looks like M1 1AA — it helps them find your home, so please add it if you can.",
        },
      ],
    },

    {
      id: 'problem_type',
      label: 'What kind of problem is it?',
      help: 'Pick the closest one. You can explain more in a moment.',
      type: 'choice',
      required: true,
      options: [
        {
          value: 'damp',
          label: 'Damp, mould or condensation',
          hint: 'Black spots on walls, peeling wallpaper, a musty smell',
        },
        { value: 'heating', label: 'Heating or hot water' },
        { value: 'leak', label: 'A leak, burst pipe or flooding' },
        { value: 'electrics', label: 'Electrics, sockets or lighting' },
        { value: 'doors-windows', label: 'Doors, windows or locks' },
        { value: 'roof', label: 'Roof, gutters or outside walls' },
        { value: 'other', label: 'Something else' },
      ],
      why: 'This decides how urgent the repair is and which trade they send — a plumber, an electrician, a joiner.',
    },

    {
      id: 'problem_detail',
      label: 'Tell us what is happening, in your own words',
      help: 'There is no right way to write this. Say what you can see, hear or smell, and which room it is in.',
      type: 'longtext',
      required: true,
      placeholder:
        'e.g. There is black mould on the bedroom wall behind the wardrobe. It has got worse since it turned cold and the room smells damp.',
      why: 'The more they know, the more likely they send the right person with the right parts first time, instead of booking a second visit.',
      validation: [
        {
          kind: 'minLength',
          value: 15,
          message:
            'Could you add a little more? Even one more sentence about which room it is in and what you can see will help.',
        },
      ],
    },

    {
      id: 'started',
      label: 'Roughly when did you first notice it?',
      help: 'A rough date is fine. If you are not sure, pick the nearest month.',
      type: 'date',
      required: false,
      why: 'How long a problem has gone on affects how urgently it is treated, and it matters if you later need to make a complaint.',
      validation: [
        {
          kind: 'notFuture',
          message:
            'That date is in the future. Did you mean a date that has already passed?',
        },
      ],
    },

    {
      id: 'safety',
      label: 'Is anyone at risk right now?',
      help: 'Tick this if the problem could hurt someone, or is making someone ill.',
      type: 'choice',
      required: true,
      options: [
        { value: 'no', label: 'No, it needs fixing but nobody is at risk' },
        {
          value: 'yes-health',
          label: 'Someone in the home is unwell because of it',
          hint: 'For example a child or older person with breathing problems in a damp room',
        },
        {
          value: 'yes-danger',
          label: 'It is dangerous — exposed wires, no heating in winter, or a bad leak',
        },
      ],
      why: 'Landlords have to treat emergency repairs much faster. Saying so here is what gets a repair moved up the list.',
    },

    {
      id: 'safety_detail',
      label: 'Can you tell us a bit more about the risk?',
      help: 'Only what you are comfortable sharing. You do not have to give medical details.',
      type: 'longtext',
      required: false,
      showWhen: { question: 'safety', equals: 'yes-health' },
      why: 'A short note helps them judge urgency. You never have to share a diagnosis to get a repair done.',
    },

    {
      id: 'access',
      label: 'When are you usually at home?',
      help: 'This saves a wasted visit and a second phone call.',
      type: 'choice',
      required: false,
      options: [
        { value: 'weekday-am', label: 'Weekday mornings' },
        { value: 'weekday-pm', label: 'Weekday afternoons' },
        { value: 'weekday-any', label: 'Any time on a weekday' },
        { value: 'evenings', label: 'Evenings only' },
        { value: 'hard', label: 'It is hard for me to be in — I need to arrange a time' },
      ],
    },

    {
      id: 'contact',
      label: 'How should they contact you?',
      help: 'A mobile number or an email address. Whichever you check most.',
      type: 'text',
      required: true,
      placeholder: 'e.g. 07700 900123',
      why: 'Repairs almost always need a phone call to book a time. Without a way to reach you, the report can sit unactioned.',
      validation: [
        {
          kind: 'minLength',
          value: 6,
          message: 'That looks too short for a phone number or email address.',
        },
      ],
    },

    {
      id: 'support_needs',
      label: 'Is there anything that would make this easier for you?',
      help: 'For example: call rather than email, speak slowly, use a certain language, or let someone else speak for you.',
      type: 'longtext',
      required: false,
      why: 'Councils can arrange interpreters, longer appointments and other adjustments, but only if they know. Most people never get asked this.',
    },
  ],

  checks: [
    {
      id: 'danger-but-no-urgency',
      needs: ['safety', 'access'],
      kind: 'choiceRequiresText',
      when: { question: 'safety', equals: 'yes-danger' },
      requires: 'contact',
      message:
        'You said the problem is dangerous. Make sure your phone number is right — for an emergency repair they will usually ring you the same day. If there is a gas smell or a serious electrical fault, do not wait for this form: ring 0800 111 999 for gas, or your landlord’s emergency line.',
    },
  ],

  nextSteps: [
    'Read back through your answers above and fix anything that looks wrong.',
    'Print it or save it, then use it to fill in your landlord’s own repair form, or read it out when you ring them.',
    'Take photos of the problem before any repair happens, and keep them.',
    'Write down the date you reported it and any reference number you are given.',
    'If nothing happens, you can complain to your landlord, then to the Housing Ombudsman. Your summary is the evidence of when you first reported it.',
  ],
};
