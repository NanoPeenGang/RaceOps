"use client";

import { cn } from "@/lib/utils";

/**
 * A real form, rather than inputs next to a button.
 *
 * The app had three `<form>` elements against 278 click handlers, and the
 * consequences were not cosmetic:
 *
 * - **Enter did nothing, anywhere.** Filling a field and pressing return is
 *   the single most practised interaction on the web.
 * - **On a phone the keyboard's Go key did nothing either**, so somebody had
 *   to dismiss the keyboard and hunt for a button that was under it. In a
 *   paddock, one-handed, that is the difference between using the app and
 *   writing on tape.
 * - **No autofill and no native validation**, so a browser could not offer a
 *   saved email and `type="email"` bought nothing.
 *
 * Two things this deliberately does. It blocks a second submit while one is in
 * flight, because Enter is easy to hit twice and half these forms create
 * something. And it never submits on Enter inside a `<textarea>` — a return in
 * a paragraph is a new line, and stealing it would make every long field
 * unusable.
 */
export function Form({
  onSubmit,
  busy,
  className,
  children,
  ...props
}: Omit<React.FormHTMLAttributes<HTMLFormElement>, "onSubmit"> & {
  onSubmit: () => void;
  /** True while the submission is in flight. */
  busy?: boolean;
}) {
  return (
    <form
      noValidate={false}
      className={cn(className)}
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        onSubmit();
      }}
      {...props}
    >
      {children}
      {/*
        A hidden submit is what makes Enter work in browsers that will not
        imply one, which is any form whose visible button lives outside it or
        carries an onClick of its own. Costs nothing and removes a whole class
        of "why does return do nothing here".
      */}
      <button type="submit" hidden aria-hidden tabIndex={-1} />
    </form>
  );
}

/**
 * A search box that behaves like one.
 *
 * `type="search"` earns three things a text input does not: the keyboard's
 * return key reads "Search" rather than "Go", a clear button appears on
 * mobile, and browsers offer previous searches. `enterKeyHint` states the
 * label rather than leaving it to the browser to infer from the form.
 */
export function SearchInput({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="search"
      enterKeyHint="search"
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
      className={cn(
        "rounded-md border border-brand-black/20 px-3 py-2 text-sm",
        className,
      )}
      {...props}
    />
  );
}
