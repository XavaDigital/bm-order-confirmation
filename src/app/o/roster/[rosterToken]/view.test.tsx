import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RosterCustomerView, type RosterCustomerViewProps } from './view';

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

type Roster = RosterCustomerViewProps['roster'];
type Member = Roster['members'][number];

function member(overrides: Partial<Member> = {}): Member {
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
    members: [],
    ...overrides,
  };
}

function renderView(roster: Roster) {
  return render(<RosterCustomerView rosterToken="raw-roster-token" roster={roster} />);
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

describe('RosterCustomerView', () => {
  it('shows the club name in the header and falls back to the order number when there is none', () => {
    renderView(baseRoster({ clubName: 'Wildcats' }));
    expect(screen.getByRole('heading', { name: 'Wildcats' })).toBeInTheDocument();

    renderView(baseRoster({ clubName: null }));
    expect(screen.getByRole('heading', { name: 'OC-1' })).toBeInTheDocument();
  });

  it('renders the roster summary and a card per member with a submitted/pending tag', () => {
    renderView(
      baseRoster({
        members: [
          member({ id: 'm1', name: 'Alex Player', submittedAt: '2026-01-10T00:00:00Z' }),
          member({ id: 'm2', name: 'Sam Coach', playerNumber: null, submittedAt: null }),
        ],
      }),
    );

    expect(screen.getByText('1 of 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Alex Player/ })).toHaveTextContent('Submitted');
    expect(screen.getByRole('button', { name: /Sam Coach/ })).toHaveTextContent('Pending');
    expect(screen.getByRole('button', { name: /Sam Coach/ })).toHaveTextContent('No number listed');
  });

  it('shows an empty-roster prompt and pre-opens the add-yourself form when there are no members', () => {
    renderView(baseRoster({ members: [] }));

    expect(screen.getByText('No team members have been added yet.')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Your name')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add my name/i })).not.toBeInTheDocument();
  });

  it('auto-selects the only member and shows their sizing form with no click needed', () => {
    renderView(baseRoster({ members: [member()] }));

    expect(screen.getByRole('button', { name: /save my sizes/i })).toBeInTheDocument();
    expect(screen.queryByText(/choose your name above/i)).not.toBeInTheDocument();
  });

  it('prompts to choose a name and hides the sizing form when multiple members exist and none is selected', () => {
    renderView(baseRoster({ members: [member({ id: 'm1' }), member({ id: 'm2', name: 'Sam Coach' })] }));

    expect(screen.getByText('Choose your name above to continue.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save my sizes/i })).not.toBeInTheDocument();
  });

  it('selecting a member swaps the size draft to their previously saved size', async () => {
    const user = userEvent.setup();
    renderView(
      baseRoster({
        members: [
          member({ id: 'm1', name: 'Alex Player', sizes: [{ garmentId: 'garment-1', size: 'M' }] }),
          member({ id: 'm2', name: 'Sam Coach', sizes: [{ garmentId: 'garment-1', size: 'L' }] }),
        ],
      }),
    );

    await user.click(screen.getByRole('button', { name: /Alex Player/ }));
    expect(screen.getByPlaceholderText(/enter your size/i)).toHaveValue('M');

    await user.click(screen.getByRole('button', { name: /Sam Coach/ }));
    expect(screen.getByPlaceholderText(/enter your size/i)).toHaveValue('L');
  });

  it('adding yourself submits to the members endpoint and selects the new member', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ id: 'new-member', name: 'Jordan New', playerNumber: '9', submittedAt: null, sizes: [] }),
    } as Response);
    renderView(baseRoster({ members: [member()] }));

    await user.click(screen.getByRole('button', { name: /add my name/i }));
    await user.type(screen.getByPlaceholderText('Your name'), 'Jordan New');
    await user.type(screen.getByPlaceholderText('Player number (optional)'), '9');
    await user.click(screen.getByRole('button', { name: /add me to the roster/i }));

    expect(fetch).toHaveBeenCalledWith(
      '/api/o/roster/raw-roster-token/members',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(body).toEqual({ name: 'Jordan New', playerNumber: '9', email: undefined });

    expect(await screen.findByRole('button', { name: /Jordan New/ })).toBeInTheDocument();
    expect(messageSuccess).toHaveBeenCalledWith('Your name has been added to the team roster.');
    // The new member becomes selected, so their (empty) sizing form is shown.
    expect(screen.getByRole('button', { name: /save my sizes/i })).toBeInTheDocument();
    // Add-self form collapses back to the button.
    expect(screen.getByRole('button', { name: /add my name/i })).toBeInTheDocument();
  });

  it('shows a validation error and does not submit when the add-yourself name is blank', async () => {
    const user = userEvent.setup();
    renderView(baseRoster({ members: [member()] }));

    await user.click(screen.getByRole('button', { name: /add my name/i }));
    await user.click(screen.getByRole('button', { name: /add me to the roster/i }));

    expect(messageError).toHaveBeenCalledWith('Please enter your name.');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('canceling the add-yourself form clears the draft and closes it', async () => {
    const user = userEvent.setup();
    renderView(baseRoster({ members: [member()] }));

    await user.click(screen.getByRole('button', { name: /add my name/i }));
    await user.type(screen.getByPlaceholderText('Your name'), 'Half-typed');
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));

    expect(screen.queryByPlaceholderText('Your name')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /add my name/i }));
    expect(screen.getByPlaceholderText('Your name')).toHaveValue('');
  });

  it('a 409 roster_locked response while adding yourself locks the roster and surfaces the server error', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ error: 'This roster is locked.', code: 'roster_locked' }),
    } as Response);
    renderView(baseRoster({ members: [member()] }));

    await user.click(screen.getByRole('button', { name: /add my name/i }));
    await user.type(screen.getByPlaceholderText('Your name'), 'Jordan New');
    await user.click(screen.getByRole('button', { name: /add me to the roster/i }));

    await vi.waitFor(() => expect(messageError).toHaveBeenCalledWith('This roster is locked.'));
    expect(screen.getByText('This roster is locked')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add me to the roster/i })).toBeDisabled();
  });

  it('shows a validation error and does not submit when a size field is left blank', async () => {
    const user = userEvent.setup();
    renderView(
      baseRoster({
        garments: [
          { id: 'garment-1', name: 'Home Jersey', notes: null, sizeCharts: [] },
          { id: 'garment-2', name: 'Shorts', notes: null, sizeCharts: [] },
        ],
        members: [member()],
      }),
    );

    const inputs = screen.getAllByPlaceholderText(/enter your size/i);
    await userEvent.setup().type(inputs[0], 'M');
    await user.click(screen.getByRole('button', { name: /save my sizes/i }));

    expect(messageError).toHaveBeenCalledWith('Please enter a size for every garment.');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('saving sizes for the first time posts to the sizes endpoint and shows a "saved" message', async () => {
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
    renderView(baseRoster({ members: [member()] }));

    await user.type(screen.getByPlaceholderText(/enter your size/i), 'M');
    await user.click(screen.getByRole('button', { name: /save my sizes/i }));

    expect(fetch).toHaveBeenCalledWith(
      '/api/o/roster/raw-roster-token/members/member-1/sizes',
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
        members: [
          member({ submittedAt: '2026-01-10T00:00:00Z', sizes: [{ garmentId: 'garment-1', size: 'M' }] }),
        ],
      }),
    );
    expect(screen.getByText('You have already submitted sizes for this roster.')).toBeInTheDocument();

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
    renderView(baseRoster({ members: [member()] }));

    await user.type(screen.getByPlaceholderText(/enter your size/i), 'M');
    await user.click(screen.getByRole('button', { name: /save my sizes/i }));

    await vi.waitFor(() => expect(messageError).toHaveBeenCalledWith('This roster is locked.'));
    expect(screen.getByText('This roster is locked')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save my sizes/i })).toBeDisabled();
    expect(screen.getByPlaceholderText(/enter your size/i)).toBeDisabled();
  });

  it('when the roster is already locked, the form and add-yourself action start disabled', () => {
    renderView(baseRoster({ locked: true, members: [member()] }));

    expect(screen.getByText('This roster is locked')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save my sizes/i })).toBeDisabled();
    expect(screen.getByPlaceholderText(/enter your size/i)).toBeDisabled();
  });

  it('a size-chart tag with a signed PDF URL opens a preview with a download link', async () => {
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
        members: [member()],
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
        members: [member()],
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
        members: [member()],
      }),
    );

    await user.click(screen.getByText('Unavailable Chart'));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
