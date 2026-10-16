import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { getForm } from '@/lib/forms';
import FormRunner from './FormRunner';

// In Next 16 route params arrive as a Promise.
type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const form = getForm(id);

  if (!form) return { title: 'Form not found — Form Buddy GM' };

  return {
    title: `${form.title} — Form Buddy GM`,
    description: form.summary,
  };
}

export default async function FormPage({ params }: Props) {
  const { id } = await params;
  const form = getForm(id);

  if (!form) notFound();

  return <FormRunner form={form} />;
}
