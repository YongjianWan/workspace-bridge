/**
 * GraphStateMachine — DependencyGraph lifecycle state machine.
 *
 * Extracted from orchestrator.js to break the dep-graph.js ↔ orchestrator.js
 * circular dependency. Both modules now depend on this shared substrate
 * instead of each other.
 */

const DG_STATES = {
  IDLE: 'IDLE',
  BUILDING: 'BUILDING',
  READY: 'READY',
  UPDATING: 'UPDATING',
  ERROR: 'ERROR',
};

const DG_VALID_TRANSITIONS = {
  [DG_STATES.IDLE]: [DG_STATES.BUILDING, DG_STATES.UPDATING, DG_STATES.READY, DG_STATES.ERROR],
  [DG_STATES.BUILDING]: [DG_STATES.READY, DG_STATES.ERROR],
  [DG_STATES.READY]: [DG_STATES.BUILDING, DG_STATES.UPDATING, DG_STATES.IDLE, DG_STATES.ERROR],
  [DG_STATES.UPDATING]: [DG_STATES.READY, DG_STATES.ERROR],
  [DG_STATES.ERROR]: [DG_STATES.IDLE, DG_STATES.BUILDING, DG_STATES.UPDATING],
};

class GraphStateMachine {
  constructor() {
    this._state = DG_STATES.IDLE;
  }

  get state() {
    return this._state;
  }

  _transition(toState) {
    const from = this._state;
    if (from === toState) return;
    const valid = DG_VALID_TRANSITIONS[from] || [];
    if (!valid.includes(toState)) {
      throw new Error(`[DependencyGraph] Invalid transition: ${from} → ${toState}`);
    }
    this._state = toState;
  }

  // O6: lifecycle helpers exposed to builder.js (avoids circular import of DG_STATES)
  _startBuilding() { this._transition(DG_STATES.BUILDING); }
  _finishBuilding() { this._transition(DG_STATES.READY); }
  _startUpdating() { this._transition(DG_STATES.UPDATING); }
  _finishUpdating() { this._transition(DG_STATES.READY); }
  _markError() { this._transition(DG_STATES.ERROR); }
  _resetState() { this._transition(DG_STATES.IDLE); }
}

module.exports = {
  DG_STATES,
  GraphStateMachine,
};
