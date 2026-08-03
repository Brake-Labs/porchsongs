/** OSS stub: premium overlay replaces this with a real feedback dialog. */

/**
 * Header button that opens a "send us feedback" dialog.
 *
 * The OSS stub renders nothing, and that is the correct behaviour rather than a
 * placeholder: delivering feedback needs a configured transactional email
 * provider and an inbox to send to, neither of which exists in open-source
 * porchsongs. A button that collected a message and dropped it would be worse
 * than no button. Self-hosters already have the "Report issue" and "Feature
 * request" links in the app menu and footer, which point at GitHub issues.
 *
 * Premium renders an icon button plus a dialog that POSTs to /api/feedback.
 */
export function FeedbackButton(): null {
  return null;
}
