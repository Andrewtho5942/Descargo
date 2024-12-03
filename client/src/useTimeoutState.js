import { useState, useCallback } from 'react';

export const useTimeoutState = (defaultState) => {
  const [state, _setState] = useState(defaultState);
  const [currentTimeoutId, setCurrentTimeoutId] = useState();

  const setState = useCallback(
    (action, opts = {}) => { 
      if (currentTimeoutId != null) {
        clearTimeout(currentTimeoutId);
      }

      _setState(action);

      // Use a timeout of 0 if no timeout value is passed
      const timeoutDuration = opts.timeout ?? 0;

      if (timeoutDuration > 0) {
        const id = setTimeout(() => _setState(defaultState), timeoutDuration);
        setCurrentTimeoutId(id);
      }
    },
    [currentTimeoutId, defaultState]
  );

  return [state, setState];
};