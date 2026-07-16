import { useEffect, useState } from 'react';
import type { CadEntity } from '../engine/cad/cadTypes';
import type { ActiveTraverseDraftView } from '../hooks/surveyCad/useSurveyCadCommandDrafts';

interface UseSurveyCadTraverseDraftPanelStateOptions {
  activeTraverseDraft: ActiveTraverseDraftView | null;
  selectedEntities: CadEntity[];
  addTraverseDraftSideshot: (_occupyPointIndex: number, _inputValue: string) => boolean;
  appendTraverseDraftPoint: (_inputValue: string) => boolean;
  insertTraverseDraftLeg: (_legIndex: number, _inputValue: string) => boolean;
  moveTraverseDraftLeg: (_legIndex: number, _direction: -1 | 1) => boolean;
  replaceTraverseDraftLeg: (_legIndex: number, _inputValue: string) => boolean;
}

export const useSurveyCadTraverseDraftPanelState = ({
  activeTraverseDraft,
  selectedEntities,
  addTraverseDraftSideshot,
  appendTraverseDraftPoint,
  insertTraverseDraftLeg,
  moveTraverseDraftLeg,
  replaceTraverseDraftLeg,
}: UseSurveyCadTraverseDraftPanelStateOptions) => {
  const [editingTraverseLegIndex, setEditingTraverseLegIndex] = useState<number | null>(null);
  const [editingTraverseLegInput, setEditingTraverseLegInput] = useState('');
  const [insertingTraverseLegIndex, setInsertingTraverseLegIndex] = useState<number | null>(null);
  const [insertingTraverseLegInput, setInsertingTraverseLegInput] = useState('');
  const [newTraverseLegInput, setNewTraverseLegInput] = useState('');
  const [newTraverseSideshotOccupyIndex, setNewTraverseSideshotOccupyIndex] = useState(1);
  const [newTraverseSideshotInput, setNewTraverseSideshotInput] = useState('');
  const selectedTraverseClosePoint =
    selectedEntities.length === 1 && selectedEntities[0]?.type === 'survey-point'
      ? selectedEntities[0]
      : null;

  useEffect(() => {
    if (!activeTraverseDraft || editingTraverseLegIndex == null) {
      if (editingTraverseLegIndex != null) {
        setEditingTraverseLegIndex(null);
        setEditingTraverseLegInput('');
      }
      return;
    }
    if (editingTraverseLegIndex >= activeTraverseDraft.legs.length) {
      setEditingTraverseLegIndex(null);
      setEditingTraverseLegInput('');
    }
  }, [activeTraverseDraft, editingTraverseLegIndex]);

  useEffect(() => {
    if (!activeTraverseDraft || insertingTraverseLegIndex == null) {
      if (insertingTraverseLegIndex != null) {
        setInsertingTraverseLegIndex(null);
        setInsertingTraverseLegInput('');
      }
      return;
    }
    if (insertingTraverseLegIndex > activeTraverseDraft.legs.length) {
      setInsertingTraverseLegIndex(null);
      setInsertingTraverseLegInput('');
    }
  }, [activeTraverseDraft, insertingTraverseLegIndex]);

  useEffect(() => {
    if (!activeTraverseDraft) {
      setInsertingTraverseLegIndex(null);
      setInsertingTraverseLegInput('');
      setNewTraverseLegInput('');
      setNewTraverseSideshotOccupyIndex(1);
      setNewTraverseSideshotInput('');
      return;
    }
    if (activeTraverseDraft.points.length <= 1) {
      setNewTraverseSideshotOccupyIndex(1);
      return;
    }
    setNewTraverseSideshotOccupyIndex((current) =>
      Math.min(Math.max(current, 1), activeTraverseDraft.points.length - 1),
    );
  }, [activeTraverseDraft]);

  const startTraverseLegEdit = (legIndex: number) => {
    const leg = activeTraverseDraft?.legs[legIndex];
    if (!leg) return;
    setEditingTraverseLegIndex(legIndex);
    setEditingTraverseLegInput(leg.inputValue);
  };

  const cancelTraverseLegEdit = () => {
    setEditingTraverseLegIndex(null);
    setEditingTraverseLegInput('');
  };

  const applyTraverseLegEdit = () => {
    if (editingTraverseLegIndex == null) return;
    const nextValue = editingTraverseLegInput.trim();
    if (nextValue.length === 0) return;
    if (replaceTraverseDraftLeg(editingTraverseLegIndex, nextValue)) {
      setEditingTraverseLegIndex(null);
      setEditingTraverseLegInput('');
    }
  };

  const appendTraverseLegFromPanel = () => {
    const nextValue = newTraverseLegInput.trim();
    if (nextValue.length === 0) return;
    if (appendTraverseDraftPoint(nextValue)) {
      setNewTraverseLegInput('');
    }
  };

  const startTraverseLegInsert = (legIndex: number) => {
    setEditingTraverseLegIndex(null);
    setEditingTraverseLegInput('');
    setInsertingTraverseLegIndex(legIndex);
    setInsertingTraverseLegInput('');
  };

  const cancelTraverseLegInsert = () => {
    setInsertingTraverseLegIndex(null);
    setInsertingTraverseLegInput('');
  };

  const applyTraverseLegInsert = () => {
    if (insertingTraverseLegIndex == null) return;
    const nextValue = insertingTraverseLegInput.trim();
    if (nextValue.length === 0) return;
    if (insertTraverseDraftLeg(insertingTraverseLegIndex, nextValue)) {
      setInsertingTraverseLegIndex(null);
      setInsertingTraverseLegInput('');
    }
  };

  const nudgeTraverseLeg = (legIndex: number, direction: -1 | 1) => {
    if (moveTraverseDraftLeg(legIndex, direction)) {
      setEditingTraverseLegIndex(null);
      setEditingTraverseLegInput('');
      setInsertingTraverseLegIndex(null);
      setInsertingTraverseLegInput('');
    }
  };

  const applyTraverseSideshot = () => {
    if (newTraverseSideshotInput.trim().length === 0) return;
    if (addTraverseDraftSideshot(newTraverseSideshotOccupyIndex, newTraverseSideshotInput.trim())) {
      setNewTraverseSideshotInput('');
    }
  };

  return {
    editingTraverseLegIndex,
    editingTraverseLegInput,
    insertingTraverseLegIndex,
    insertingTraverseLegInput,
    newTraverseLegInput,
    newTraverseSideshotInput,
    newTraverseSideshotOccupyIndex,
    selectedTraverseClosePoint,
    applyTraverseLegEdit,
    applyTraverseLegInsert,
    applyTraverseSideshot,
    appendTraverseLegFromPanel,
    cancelTraverseLegEdit,
    cancelTraverseLegInsert,
    nudgeTraverseLeg,
    setEditingTraverseLegInput,
    setInsertingTraverseLegInput,
    setNewTraverseLegInput,
    setNewTraverseSideshotInput,
    setNewTraverseSideshotOccupyIndex,
    startTraverseLegEdit,
    startTraverseLegInsert,
  };
};
