import Link from 'next/link';

export default function NotFound() {
  return (
    <>
      <h1>We could not find that page</h1>
      <p className="lede">
        The link may be out of date, or the form may have been renamed.
      </p>
      <p>
        <Link href="/" className="btn">
          See all forms
        </Link>
      </p>
    </>
  );
}
