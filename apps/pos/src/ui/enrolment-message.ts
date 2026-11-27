import { ApiRequestError } from '../sync/api-client';
import { EnrolmentError, type EnrolmentFailure } from '../sync/enrol-terminal';

const ENROLMENT_MESSAGES: Record<EnrolmentFailure, string> = {
  INVALID_URL: 'Check the server address. It must start with https://',
  INVALID_CODE: 'Enter the enrolment code: at least 8 characters.',
  ALREADY_ENROLLED: 'This device is already set up as a terminal. Reload the page.',
};

function requestMessage({ kind, status, code }: ApiRequestError): string {
  switch (kind) {
    case 'network':
      return "Can't reach the server. Check the internet connection and the server address.";
    case 'invalid_response':
      return 'The server sent an unexpected reply. Check the server address and any Wi-Fi sign-in page.';
    case 'http':
      if (code === 'INVALID_ENROLMENT_CODE') return 'That enrolment code is not valid.';
      if (status === 401) return 'The server no longer accepts this terminal. Ask the manager.';
      if (status === 429) return 'Too many attempts. Wait a minute and try again.';
      return 'The server had a problem. Try again shortly.';
  }
}

/** What to tell staff. Raw errors are never shown. */
export function enrolmentMessage(error: unknown): string {
  if (error instanceof EnrolmentError) return ENROLMENT_MESSAGES[error.code];
  if (error instanceof ApiRequestError) return requestMessage(error);
  return 'Something went wrong. Try again.';
}
