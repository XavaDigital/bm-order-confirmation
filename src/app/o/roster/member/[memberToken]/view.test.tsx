import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RosterMemberView, type RosterMemberViewProps } from './view';

vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @next/next/no-img-element
    return <img alt={props.alt as string} {...props} />;
  },
}));

// The component calls the antd static `message` API (not App.useApp()), which
// mounts its holder outside the component tree in a way that isn't reliably
// visible to jsdom/RTL. Spy on it directly instead of asserting on rendered text.
const { messageError, messageSuccess } = vi.hoisted(() => ({
  messageError: vi.fn(),
  messageSuccess: vi.fn(),
}));
vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<typeof import('antd')>();
  return {
    ...actual,
    message: { ...actual.message, error: messageError, success: messageSuccess },
  };
});

type Roster = RosterMemberViewProps['roster'];
type Member = Roster['member'];

function baseMember(overrides: Partial<Member> = {}): Member {
  return {
    id: 'member-1',
    name: 'Alex Player',
    playerNumber: '7',
    submittedAt: null,
    sizes: [],
    ...overrides,
  };
}

function baseRoster(overrides: Partial<Roster> = {}): Roster {
  return {
    orderNumber: 'OC-1',
    clubName: 'Wildcats',
    locked: false,
    garments: [{ id: 'garment-1', name: 'Home Jersey', notes: null, sizeCharts: [] }],
    member: baseMember(),
    ...overrides,
  };
}

function renderView(roster: Roster) {
  return render(<RosterMemberView memberToken="raw-member-token" roster={roster} />);
}

async function waitForModalToClose() {
  await vi.waitFor(() => {
    document
      .querySelectorAll('.ant-zoom-leave-active, .ant-fade-leave-active')
      .forEach((el) => fireEvent.transitionEnd(el));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  messageError.mockClear();
  messageSuccess.mockClear();
});

describe('RosterMemberView', () => {
  it('renders the member name as the heading and the order/player details', () => {
    renderView(baseRoster());

    expect(screen.getByRole('heading', { name: 'Alex Player' })).toBeInTheDocument();
    expect(screen.getByText('OC-1')).toBeInTheDocument();
    expect(screen.getByText('Wildcats')).toBeInTheDocument();
    expect(screen.getByText('#7')).toBeInTheDocument();
  });

  it('shows "Not listed" when the member has no player number', () => {
    renderView(baseRoster({ member: baseMember({ playerNumber: null }) }));

    expect(screen.getByText('Not listed')).toBeInTheDocument();
  });

  it('shows the already-submitted alert only when the member has previously submitted', () => {
    renderView(baseRoster({ member: baseMember({ submittedAt: null }) }));
    expect(screen.queryByText(/already submitted sizes/i)).not.toBeInTheDocument();

    renderView(baseRoster({ member: baseMember({ submittedAt: '2026-01-10T00:00:00Z' }) }));
    expect(screen.getByText(/already submitted sizes/i)).toBeInTheDocument();
  });

  it('pre-fills the size input from the member\'s existing submission', () => {
    renderView(
      baseRoster({ member: baseMember({ sizes: [{ garmentId: 'garment-1', size: 'L' }] }) }),
    );

    expect(screen.getByPlaceholderText(/enter your size/i)).toHaveValue('L');
  });

  it('shows a validation error and does not submit when a size field is left blank', async () => {
    const user = userEvent.setup();
    renderView(
      baseRoster({
        garments: [
          { id: 'garment-1', name: 'Home Jersey', notes: null, sizeCharts: [] },
          { id: 'garment-2', name: 'Shorts', notes: null, sizeCharts: [] },
        ],
      }),
    );

    const inputs = screen.getAllByPlaceholderText(/enter your size/i);
    await user.type(inputs[0], 'M');
    await user.click(screen.getByRole('button', { name: /save my sizes/i }));

    expect(messageError).toHaveBeenCalledWith('Please enter a size for every garment.');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('saving sizes for the first time posts to the member sizes endpoint and shows a "saved" message', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'member-1',
        name: 'Alex Player',
        playerNumber: '7',
        submittedAt: '2026-01-15T00:00:00Z',
        sizes: [{ garmentId: 'garment-1', size: 'M' }],
      }),
    } as Response);
    renderView(baseRoster());

    await user.type(screen.getByPlaceholderText(/enter your size/i), 'M');
    await user.click(screen.getByRole('button', { name: /save my sizes/i }));

    expect(fetch).toHaveBeenCalledWith(
      '/api/o/roster/member/raw-member-token/sizes',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(body).toEqual({ sizes: [{ garmentId: 'garment-1', size: 'M' }] });

    await vi.waitFor(() =>
      expect(messageSuccess).toHaveBeenCalledWith('Your sizes have been saved.'),
    );
    expect(await screen.findByRole('button', { name: /update my sizes/i })).toBeInTheDocument();
  });

  it('re-saving an already-submitted member shows an "updated" message', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'member-1',
        name: 'Alex Player',
        playerNumber: '7',
        submittedAt: '2026-01-15T00:00:00Z',
        sizes: [{ garmentId: 'garment-1', size: 'L' }],
      }),
    } as Response);
    renderView(
      baseRoster({
        member: baseMember({
          submittedAt: '2026-01-10T00:00:00Z',
          sizes: [{ garmentId: 'garment-1', size: 'M' }],
        }),
      }),
    );

    await user.clear(screen.getByPlaceholderText(/enter your size/i));
    await user.type(screen.getByPlaceholderText(/enter your size/i), 'L');
    await user.click(screen.getByRole('button', { name: /update my sizes/i }));

    await vi.waitFor(() =>
      expect(messageSuccess).toHaveBeenCalledWith('Your sizes have been updated.'),
    );
  });

  it('a 409 roster_locked response while saving sizes locks the roster and disables the form', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ error: 'This roster is locked.', code: 'roster_locked' }),
    } as Response);
    renderView(baseRoster());

    await user.type(screen.getByPlaceholderText(/enter your size/i), 'M');
    await user.click(screen.getByRole('button', { name: /save my sizes/i }));

    await vi.waitFor(() => expect(messageError).toHaveBeenCalledWith('This roster is locked.'));
    expect(screen.getByText('This roster is locked')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save my sizes/i })).toBeDisabled();
    expect(screen.getByPlaceholderText(/enter your size/i)).toBeDisabled();
  });

  it('shows a generic error message when the server response has no error field', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as Response);
    renderView(baseRoster());

    await user.type(screen.getByPlaceholderText(/enter your size/i), 'M');
    await user.click(screen.getByRole('button', { name: /save my sizes/i }));

    await vi.waitFor(() => expect(messageError).toHaveBeenCalledWith('Failed to save sizes'));
  });

  it('when the roster is already locked, the form starts disabled and does not call fetch on click', async () => {
    const user = userEvent.setup();
    renderView(baseRoster({ locked: true }));

    expect(screen.getByText('This roster is locked')).toBeInTheDocument();
    const saveButton = screen.getByRole('button', { name: /save my sizes/i });
    expect(saveButton).toBeDisabled();
    expect(screen.getByPlaceholderText(/enter your size/i)).toBeDisabled();

    await user.click(saveButton);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('a size-chart tag with a signed PDF URL opens a preview with a download link, and Close hides it', async () => {
    const user = userEvent.setup();
    renderView(
      baseRoster({
        garments: [
          {
            id: 'garment-1',
            name: 'Home Jersey',
            notes: null,
            sizeCharts: [
              {
                name: 'Adult Chart',
                storageKey: 'charts/adult.pdf',
                url: 'https://signed.example.com/adult.pdf',
                downloadUrl: 'https://signed.example.com/adult.pdf?dl=1',
              },
            ],
          },
        ],
      }),
    );

    await user.click(screen.getByText('Adult Chart'));
    const dialog = await screen.findByRole('dialog');
    const iframe = within(dialog).getByTitle('Adult Chart') as HTMLIFrameElement;
    expect(iframe.tagName).toBe('IFRAME');
    expect(iframe.src).toBe('https://signed.example.com/adult.pdf');
    expect(within(dialog).getByRole('link', { name: /download/i })).toHaveAttribute(
      'href',
      'https://signed.example.com/adult.pdf?dl=1',
    );

    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitForModalToClose();
  });

  it('a size-chart tag for a non-PDF image opens a preview image with no download link when none is available', async () => {
    const user = userEvent.setup();
    renderView(
      baseRoster({
        garments: [
          {
            id: 'garment-1',
            name: 'Home Jersey',
            notes: null,
            sizeCharts: [
              {
                name: 'Kids Chart',
                storageKey: 'charts/kids.png',
                url: 'https://signed.example.com/kids.png',
                downloadUrl: null,
              },
            ],
          },
        ],
      }),
    );

    await user.click(screen.getByText('Kids Chart'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByAltText('Kids Chart')).toBeInTheDocument();
    expect(within(dialog).queryByRole('link', { name: /download/i })).not.toBeInTheDocument();
  });

  it('a size-chart tag with no signed URL is not clickable and opens no preview', async () => {
    const user = userEvent.setup();
    renderView(
      baseRoster({
        garments: [
          {
            id: 'garment-1',
            name: 'Home Jersey',
            notes: null,
            sizeCharts: [{ name: 'Unavailable Chart', storageKey: null, url: null, downloadUrl: null }],
          },
        ],
      }),
    );

    await user.click(screen.getByText('Unavailable Chart'));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders garment notes when present', () => {
    renderView(
      baseRoster({
        garments: [
          { id: 'garment-1', name: 'Home Jersey', notes: 'Runs small, size up.', sizeCharts: [] },
        ],
      }),
    );

    expect(screen.getByText('Runs small, size up.')).toBeInTheDocument();
  });
});
