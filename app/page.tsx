import Link from 'next/link';
import { listForms } from '@/lib/forms';

/*
 * The same sentence, in the languages Greater Manchester actually speaks.
 *
 * This is the hero rather than a feature bullet because it does the
 * explaining by itself: someone who reads Urdu or Polish understands the
 * whole product without reading a word of English, and a judge sees the
 * point of the tool in one glance. Claiming "supports 99 languages" in a
 * list would say less.
 *
 * Six lines, not ninety-nine — enough to show breadth, few enough to read.
 */
const SAME_SENTENCE = [
  { lang: 'ur', dir: 'rtl', text: 'اپنے الفاظ میں بتائیں۔' },
  { lang: 'pl', dir: 'ltr', text: 'Powiedz to swoimi słowami.' },
  { lang: 'ro', dir: 'ltr', text: 'Spune-o în cuvintele tale.' },
  { lang: 'ar', dir: 'rtl', text: 'قُلها بكلماتك الخاصة.' },
  { lang: 'bn', dir: 'ltr', text: 'আপনার নিজের ভাষায় বলুন।' },
  { lang: 'so', dir: 'ltr', text: 'Ku sheeg ereyadaada.' },
] as const;

export default function HomePage() {
  const forms = listForms();

  return (
    <>
      <section className="hero">
        <h1>Say it in your own words.</h1>

        <ul className="hero-langs">
          {SAME_SENTENCE.map((line) => (
            <li key={line.lang} lang={line.lang} dir={line.dir}>
              {line.text}
            </li>
          ))}
        </ul>

        <p className="hero-sub">
          Speak your answers to a council form in whichever language comes
          easiest. We write them down, put an English version on the form so the
          council can read it, and <strong>keep your own words alongside it</strong>.
        </p>

        <Link href={`/form/${forms[0].id}`} className="btn btn-honey">
          Start a form
        </Link>
      </section>

      <h2 id="pick">Which form do you need?</h2>
      <ul className="form-list" aria-labelledby="pick">
        {forms.map((form) => (
          <li key={form.id}>
            <Link href={`/form/${form.id}`} className="form-link">
              <h2>{form.title}</h2>
              <p>{form.summary}</p>
              <div className="form-meta">
                <span>About {form.estimatedMinutes} minutes</span>
                <span>{form.questionCount} questions</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>

      <h2>What this does, and what it cannot</h2>
      <p>
        It writes down what you say and helps you get your answers ready. It
        cannot tell you whether you qualify for anything, and it cannot send your
        application. Your council decides that, and a person makes the decision.
      </p>
      <p>
        Machine translation gets things wrong, so you can always check and correct
        what we wrote before you use it.
      </p>

      <h2>If you would rather not do this on a screen</h2>
      <p>
        Print your answers at the end and take them to a library, a community
        centre or your council&rsquo;s front desk, or read them down the phone. You
        can also type every answer instead of speaking it.
      </p>
    </>
  );
}
