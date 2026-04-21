import React from 'react';
import styles from './Expand.module.css';
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faUpRightAndDownLeftFromCenter, faDownLeftAndUpRightToCenter } from "@fortawesome/free-solid-svg-icons";
import { useNodeActionsContext } from "../../../providers/FlowProvider";

const Expand = ({ }) => {

    const {
        setAllMinimized,
        allMinimized,
        expandStatus,
        setExpandStatus
    } = useNodeActionsContext();

    const toggleMinimized = () => {
        if(expandStatus == 'expanded'){
            setExpandStatus('minimized');
            setAllMinimized(allMinimized+1);
        }else{
            setExpandStatus('expanded');
            setAllMinimized(0);
        }
    }

    return (
        <>
            <button
                className={styles.icon}
                type="button"
                onClick={toggleMinimized}
            >
                {expandStatus === 'expanded' ? (
                    <FontAwesomeIcon icon={faDownLeftAndUpRightToCenter} />
                ) : expandStatus === 'minimized' ? (
                    <FontAwesomeIcon icon={faUpRightAndDownLeftFromCenter} />
                ) : null}
            </button>
        </>
    );
};

export default Expand;
