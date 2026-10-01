'use client';

import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';
import { ROOT_SCOPE, useIvcca } from '../store';
import type { MatrixData } from '../types';
import { Btn, EmptyState, LockedState } from '../ui';

/** Renders children only once a correlation matrix exists; otherwise explains what's missing. */
export function RequireCorrelation({ children }: { children: ReactNode }) {
  const { session, setActiveTool } = useIvcca();
  if (!session) {
    return (
      <LockedState
        title="Load a dataset first"
        description="Upload an expression matrix (samples × genes) to start an IVCCA session."
        action={
          <Btn variant="primary" onClick={() => setActiveTool('data')}>
            Go to dataset
          </Btn>
        }
      />
    );
  }
  if (!session.correlation) {
    return (
      <LockedState
        title="Compute the correlation matrix first"
        description="Every analysis in IVCCA works on the gene × gene correlation matrix."
        action={
          <Btn variant="primary" onClick={() => setActiveTool('correlation')}>
            Go to correlation
          </Btn>
        }
      />
    );
  }
  return <>{children}</>;
}

/**
 * For gene-set tools, which always read the original dataset: waits for the full-dataset
 * matrix even while a pathway matrix is the active scope.
 */
export function RequireRootMatrix({ children }: { children: (matrix: MatrixData) => ReactNode }) {
  const { scopes, rootMatrix, ensureMatrix, sessionExpired } = useIvcca();
  const root = scopes.find((s) => s.id === ROOT_SCOPE);
  const needsFetch = Boolean(root?.correlation) && !rootMatrix && root?.matrixStatus === 'idle';
  useEffect(() => {
    if (needsFetch) ensureMatrix(ROOT_SCOPE);
  }, [needsFetch, ensureMatrix]);

  return (
    <RequireCorrelation>
      {rootMatrix ? (
        children(rootMatrix)
      ) : sessionExpired ? (
        <EmptyState title="Session unavailable" description="Reload the dataset using the banner above to continue." />
      ) : root?.matrixStatus === 'error' ? (
        <EmptyState
          title="The full correlation matrix could not be loaded"
          action={
            <Btn variant="primary" onClick={() => ensureMatrix(ROOT_SCOPE)}>
              Retry
            </Btn>
          }
        />
      ) : (
        <EmptyState icon={<LoaderCircle className="h-5 w-5 animate-spin" />} title="Loading the full correlation matrix…" />
      )}
    </RequireCorrelation>
  );
}

/** Like RequireCorrelation, but also waits for the client-side copy of the matrix. */
export function RequireMatrix({ children }: { children: (matrix: MatrixData) => ReactNode }) {
  const { session, retryMatrix, errors, sessionExpired } = useIvcca();
  return (
    <RequireCorrelation>
      {session?.matrix ? (
        children(session.matrix)
      ) : sessionExpired ? (
        <EmptyState
          title="Session unavailable"
          description="Reload the dataset using the banner above to continue where you left off."
        />
      ) : session?.matrixStatus === 'error' ? (
        <EmptyState
          title="The correlation matrix could not be loaded"
          description={errors.matrix ?? 'Try again.'}
          action={
            <Btn variant="primary" onClick={retryMatrix}>
              Retry
            </Btn>
          }
        />
      ) : (
        <EmptyState
          icon={<LoaderCircle className="h-5 w-5 animate-spin" />}
          title="Loading the correlation matrix…"
          description="Transferring the gene × gene matrix to your browser for interactive exploration."
        />
      )}
    </RequireCorrelation>
  );
}
