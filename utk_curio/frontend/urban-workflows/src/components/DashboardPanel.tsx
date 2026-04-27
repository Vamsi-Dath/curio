import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faLock, faLockOpen, faXmark } from '@fortawesome/free-solid-svg-icons';
import { useFlowContext } from '../providers/FlowProvider';

export function DashboardPanel() {
    const { setDashBoardMode, dashboardLocked, setDashboardLocked } = useFlowContext();

    const btnStyle: React.CSSProperties = {
        background: 'rgba(255,255,255,0.85)',
        border: '1px solid #ccc',
        cursor: 'pointer',
        fontSize: 14,
        lineHeight: 1,
        color: '#555',
        padding: '6px 10px',
        borderRadius: 6,
        boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
    };

    return (
        <div
            style={{
                position: 'fixed',
                top: 12,
                right: 16,
                zIndex: 101,
                display: 'flex',
                gap: 6,
            }}
        >
            <button
                onClick={() => setDashboardLocked(v => !v)}
                title={dashboardLocked ? 'Unlock layout' : 'Lock layout'}
                style={btnStyle}
            >
                <FontAwesomeIcon icon={dashboardLocked ? faLock : faLockOpen} />
            </button>
            <button
                onClick={() => setDashBoardMode(false)}
                title="Exit Dashboard Mode"
                style={btnStyle}
            >
                <FontAwesomeIcon icon={faXmark} />
            </button>
        </div>
    );
}
