import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { EnrolmentScreen } from './EnrolmentScreen';

const render = (state: 'not_enrolled' | 'needs_download') =>
  renderToString(
    <EnrolmentScreen
      state={state}
      defaultApiUrl="http://localhost:3000"
      onEnrol={vi.fn()}
      onDownload={vi.fn()}
    />,
  );

describe('EnrolmentScreen', () => {
  it('asks for the server address and the enrolment code', () => {
    const html = render('not_enrolled');

    expect(html).toContain('Server address');
    expect(html).toContain('value="http://localhost:3000"');
    expect(html).toContain('Enrolment code');
    expect(html).toContain('Set up terminal');
  });

  it('offers the catalogue download once enrolled, without asking for a code again', () => {
    const html = render('needs_download');

    expect(html).toContain('Download catalogue');
    expect(html).not.toContain('Enrolment code');
  });
});
