import * as React from 'react';
import { useMachine } from '../src';
import { Machine, assign, Interpreter, spawn, doneInvoke, State } from 'xstate';
import {
  render,
  fireEvent,
  cleanup,
  waitForElement
} from '@testing-library/react';
import { useState } from 'react';

afterEach(cleanup);

describe('useMachine hook', () => {
  const context = {
    data: undefined
  };
  const fetchMachine = Machine<typeof context>({
    id: 'fetch',
    initial: 'idle',
    context,
    states: {
      idle: {
        on: { FETCH: 'loading' }
      },
      loading: {
        invoke: {
          src: 'fetchData',
          onDone: {
            target: 'success',
            actions: assign({
              data: (_, e) => e.data
            }),
            cond: (_, e) => e.data.length
          }
        }
      },
      success: {
        type: 'final'
      }
    }
  });

  const persistedFetchState = fetchMachine.transition(
    'loading',
    doneInvoke('fetchData', 'persisted data')
  );

  const Fetcher: React.FC<{
    onFetch: () => Promise<any>;
    persistedState?: State<any, any>;
  }> = ({
    onFetch = () => new Promise(res => res('some data')),
    persistedState
  }) => {
    const [current, send] = useMachine(fetchMachine, {
      services: {
        fetchData: onFetch
      },
      state: persistedState
    });

    switch (current.value) {
      case 'idle':
        return <button onClick={_ => send('FETCH')}>Fetch</button>;
      case 'loading':
        return <div>Loading...</div>;
      case 'success':
        return (
          <div>
            Success! Data: <div data-testid="data">{current.context.data}</div>
          </div>
        );
      default:
        return null;
    }
  };

  it('should work with the useMachine hook', async () => {
    const { getByText, getByTestId } = render(
      <Fetcher onFetch={() => new Promise(res => res('fake data'))} />
    );
    const button = getByText('Fetch');
    fireEvent.click(button);
    getByText('Loading...');
    await waitForElement(() => getByText(/Success/));
    const dataEl = getByTestId('data');
    expect(dataEl.textContent).toBe('fake data');
  });

  it('should work with the useMachine hook (rehydrated state)', async () => {
    const { getByText, getByTestId } = render(
      <Fetcher
        onFetch={() => new Promise(res => res('fake data'))}
        persistedState={persistedFetchState}
      />
    );

    await waitForElement(() => getByText(/Success/));
    const dataEl = getByTestId('data');
    expect(dataEl.textContent).toBe('persisted data');
  });

  it('should work with the useMachine hook (rehydrated state config)', async () => {
    const persistedFetchStateConfig = JSON.parse(
      JSON.stringify(persistedFetchState)
    );
    const { getByText, getByTestId } = render(
      <Fetcher
        onFetch={() => new Promise(res => res('fake data'))}
        persistedState={persistedFetchStateConfig}
      />
    );

    await waitForElement(() => getByText(/Success/));
    const dataEl = getByTestId('data');
    expect(dataEl.textContent).toBe('persisted data');
  });

  it('should provide the service', () => {
    const Test = () => {
      const [, , service] = useMachine(fetchMachine);

      if (!(service instanceof Interpreter)) {
        throw new Error('service not instance of Interpreter');
      }

      return null;
    };

    render(<Test />);
  });

  it('should provide options for the service', () => {
    const Test = () => {
      const [, , service] = useMachine(fetchMachine, {
        execute: false
      });

      expect(service.initialized).toBe(false);
      expect(service.options.execute).toBe(false);

      return null;
    };

    render(<Test />);
  });

  it('should start the service immediately if the immediate option is enabled', () => {
    const testMachine = Machine({
      initial: 'idle',
      states: {
        idle: {}
      }
    });

    const Test = () => {
      const [, , service] = useMachine(testMachine, { immediate: true });

      expect(service.initialized).toBe(true);

      return null;
    };

    render(<Test />);
  });

  it('should support the immediate option when the initial state has a transient transition', () => {
    const testMachine = Machine({
      initial: 'bootstrap',
      states: {
        bootstrap: {
          on: {
            '': {
              target: 'idle'
            }
          }
        },
        idle: {}
      }
    });

    const Test = () => {
      const [state, , service] = useMachine(testMachine, { immediate: true });

      expect(service.initialized).toBe(true);
      expect(state.value).toBe('idle');

      return null;
    };

    render(<Test />);
  });

  it('should merge machine context with options.context', () => {
    const testMachine = Machine<{ foo: string; test: boolean }>({
      context: {
        foo: 'bar',
        test: false
      },
      initial: 'idle',
      states: {
        idle: {}
      }
    });

    const Test = () => {
      const [state] = useMachine(testMachine, { context: { test: true } });

      expect(state.context).toEqual({
        foo: 'bar',
        test: true
      });

      return null;
    };

    render(<Test />);
  });

  it('should not spawn actors until service is started', async done => {
    const spawnMachine = Machine<any>({
      id: 'spawn',
      initial: 'start',
      context: { ref: undefined },
      states: {
        start: {
          entry: assign({
            ref: () => spawn(new Promise(res => res(42)), 'my-promise')
          }),
          on: {
            [doneInvoke('my-promise')]: 'success'
          }
        },
        success: {
          type: 'final'
        }
      }
    });

    const Spawner = () => {
      const [current] = useMachine(spawnMachine);

      switch (current.value) {
        case 'start':
          return <span data-testid="start" />;
        case 'success':
          return <span data-testid="success" />;
        default:
          return null;
      }
    };

    const { getByTestId } = render(<Spawner />);
    await waitForElement(() => getByTestId('success'));
    done();
  });

  it('actions should not have stale data', async done => {
    const toggleMachine = Machine({
      initial: 'inactive',
      states: {
        inactive: {
          on: { TOGGLE: 'active' }
        },
        active: {
          entry: 'doAction'
        }
      }
    });

    const Toggle = () => {
      const [ext, setExt] = useState(false);

      const doAction = React.useCallback(() => {
        expect(ext).toBeTruthy();
        done();
      }, [ext]);

      const [, send] = useMachine(toggleMachine, {
        actions: {
          doAction
        }
      });

      return (
        <>
          <button
            data-testid="extbutton"
            onClick={_ => {
              setExt(true);
            }}
          />
          <button
            data-testid="button"
            onClick={_ => {
              send('TOGGLE');
            }}
          />
        </>
      );
    };

    const { getByTestId } = render(<Toggle />);

    const button = getByTestId('button');
    const extButton = getByTestId('extbutton');
    fireEvent.click(extButton);

    fireEvent.click(button);
  });
});
