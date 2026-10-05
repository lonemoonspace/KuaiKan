import { useEffect, useState, useRef, useCallback } from 'react';
import { storage, type StorageItemKey } from '#imports';

import { createLogger } from '@/lib/logger';

const logger = createLogger('hooks:useWxtStorage');

/**
 * A React hook to read, write, and synchronize state with WXT storage.
 * Supports cross-context updates automatically.
 *
 * @param key The storage key (must be prefixed with local:, sync:, session:, or managed:), or null to disable persistence
 * @param defaultValue The fallback value if storage is empty
 */
export default function useWxtStorage<T>(key: StorageItemKey | null | undefined, defaultValue: T) {
  const [value, setValue] = useState<T>(defaultValue);
  const [isLoaded, setIsLoaded] = useState(false);
  
  // Track default value in a ref to avoid recreating the effect if the reference changes
  const defaultValueRef = useRef(defaultValue);
  defaultValueRef.current = defaultValue;

  // Keep the latest value in a ref so functional updates always resolve against
  // current state, even when several updates are scheduled before React re-renders.
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    let active = true;

    if (!key) {
      // If no key provided, just mark as loaded and use default value
      if (active) {
        setIsLoaded(true);
      }
      return;
    }

    // Tracks whether a watch update arrived before the initial snapshot read
    // resolved. In that window, applying the older getItem snapshot afterwards
    // would clobber the newer value written by another context.
    let watchedDuringInitialLoad = false;

    async function loadInitial() {
      try {
        const storedValue = await storage.getItem<T>(key as StorageItemKey, {
          fallback: defaultValueRef.current,
        });
        if (active && !watchedDuringInitialLoad) {
          setValue(storedValue ?? defaultValueRef.current);
        }
      } catch (error) {
        logger.error(`[useWxtStorage] Failed to get storage key "${key}":`, error);
      } finally {
        if (active) {
          setIsLoaded(true);
        }
      }
    }

    loadInitial();

    // Watch for changes (from other scripts / tabs / options pages)
    const unwatch = storage.watch<T>(key as StorageItemKey, (newValue) => {
      watchedDuringInitialLoad = true;
      if (active) {
        setValue(newValue ?? defaultValueRef.current);
      }
    });

    return () => {
      active = false;
      unwatch();
    };
  }, [key]);

  // Writable wrapper
  const setStorageValue = useCallback(
    async (newValue: T | ((prev: T) => T)) => {
      const resolvedValue =
        typeof newValue === 'function'
          ? (newValue as (prev: T) => T)(valueRef.current)
          : newValue;

      const previousValue = valueRef.current;
      valueRef.current = resolvedValue;
      setValue(resolvedValue);

      if (!key) return;

      try {
        await storage.setItem(key as StorageItemKey, resolvedValue);
      } catch (error) {
        logger.error(`[useWxtStorage] Failed to set storage key "${key}":`, error);

        // Put the previous value back: the optimistic update above would
        // otherwise leave the UI showing a value that never reached storage
        // (until some future read happened to correct it). Skip the rollback if
        // something newer was set while this write was in flight — that value
        // is the current truth.
        if (valueRef.current === resolvedValue) {
          valueRef.current = previousValue;
          setValue(previousValue);
        }
      }
    },
    [key]
  );

  return [value, setStorageValue, isLoaded] as const;
}
