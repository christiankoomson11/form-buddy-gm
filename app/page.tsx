import Link from 'next/link';
import { listForms } from '@/lib/forms';

export default function HomePage() {
  const forms = listForms();

  return (
    <>
      <h1>Fill in a council form by speaking</h1>
      <p className="lede">
        One question at a time. Say your answer out loud in whichever language
        you speak most easily, and we will write it down and put an English
        version on the form. You can type instead at any point.
      </p>

      <h2 id="pick">Which form do you need?</h2>
      <ul className="form-list" aria-labelledby="pick">
        {forms.map((form) => (
          <li key={form.id}>
            <Link href={`/form/${form.id}`} className="form-link">
              <h2>{form.title}</h2>
              <p>{form.summary}</p>
              <div className="form-meta">
                <span className="chip">About {form.estimatedMinutes} minutes</span>
                <span className="chip">{form.questionCount} questions</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>

      <div className="notice notice-info">
        <p>
          <strong>What this tool does and does not do</strong>
        </p>
        <p>
          It writes down what you say and helps you get your answers ready. It
          cannot tell you whether you qualify for anything, and it cannot send
          your application. Your council decides that, and a person makes the
          decision.
        </p>
      </div>

      <h2>Answering in another language</h2>
      <p>
        Speak whichever language you are most comfortable in. We put an English
        version on the form so the council can read it, and we keep your own
        words alongside it, including on the printout. Machine translation gets
        things wrong, so you can always check and correct what we wrote.
      </p>

      <h2>If you would rather not do this online</h2>
      <p>
        You can print your answers at the end and take them to a library,
        community centre or your council&rsquo;s front desk, or read them out over the
        phone. You do not have to finish anything on a screen.
      </p>
    </>
  );
}
