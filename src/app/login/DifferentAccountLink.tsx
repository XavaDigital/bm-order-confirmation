'use client';

import { Button } from 'antd';

/**
 * After a refusal, the Google button on its own is a dead end: the browser is
 * still signed in to Google, so pressing it re-submits the same account and
 * earns the same refusal. This hands the person to Google's account chooser and
 * brings them back here.
 *
 * There is deliberately no "log out" button — the app session was already
 * destroyed server-side before this page was rendered, so there is nothing left
 * to log out of, and offering it would imply otherwise.
 */
export function DifferentAccountLink() {
  function chooseAccount() {
    const back = `${window.location.origin}/login`;
    window.location.href = `https://accounts.google.com/AccountChooser?continue=${encodeURIComponent(back)}`;
  }

  return (
    <Button type="link" size="small" onClick={chooseAccount} style={{ padding: 0 }}>
      Use a different Google account
    </Button>
  );
}
