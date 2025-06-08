// frontend/src/App.jsx
import React, { useState, useRef } from 'react';
import axios from 'axios';
import FileUploader from './components/FileUploader';
import OCRProcessor from './components/OCRProcessor';
import LLMProcessor from './components/LLMProcessor';
import JobHistory from './components/JobHistory';
import DocumentViewer from './components/DocumentViewer';
import GlobalStatusBar from './components/GlobalStatusBar';
import './App.css';

// Draggable Text Dialog Component
function DraggableTextDialog({ ocrResults, manualOcrResults = [], highlightedDetectionIndex, onClose, onTextClick, textItemStates, onTextItemToggle, onFieldNameChange }) {
  const [position, setPosition] = useState({ x: 100, y: 100 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const dialogRef = useRef(null);

  const handleMouseDown = (e) => {
    if (e.target.closest('.text-dialog-content') || e.target.closest('.close-button')) {
      return;
    }
    
    setIsDragging(true);
    const rect = dialogRef.current.getBoundingClientRect();
    setDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    });
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    
    setPosition({
      x: e.clientX - dragOffset.x,
      y: e.clientY - dragOffset.y
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  React.useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, dragOffset]);

  return (
    <div className="text-dialog-overlay">
      <div 
        ref={dialogRef}
        className="text-dialog draggable"
        style={{
          position: 'fixed',
          left: position.x,
          top: position.y,
          cursor: isDragging ? 'grabbing' : 'grab'
        }}
        onMouseDown={handleMouseDown}
      >
        <div className="text-dialog-header">
          <h3>Detected Text</h3>
          <button 
            className="close-button"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="text-dialog-content">
          {ocrResults.map((page, pageIndex) => (
            <div key={pageIndex} className="page-text">
              {ocrResults.length > 1 && <h4>Page {page.page_number}</h4>}
              {page.detections.map((detection, detectionIndex) => {
                const globalIndex = pageIndex * 1000 + detectionIndex;
                const isVisible = textItemStates[globalIndex]?.visible ?? true;
                const fieldName = textItemStates[globalIndex]?.fieldName ?? '';
                return (
                  <div 
                    key={detectionIndex}
                    className={`text-item ${
                      highlightedDetectionIndex === globalIndex ? 'highlighted' : ''
                    } ${!isVisible ? 'hidden-item' : ''}`}
                    style={{ 
                      border: '1px solid #ddd', 
                      margin: '5px 0', 
                      padding: '8px',
                      backgroundColor: isVisible ? '#fff' : '#f5f5f5',
                      opacity: isVisible ? 1 : 0.6
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '5px' }}>
                      <button
                        onClick={() => onTextItemToggle(globalIndex)}
                        style={{
                          marginRight: '8px',
                          padding: '2px 6px',
                          fontSize: '12px',
                          backgroundColor: isVisible ? '#28a745' : '#6c757d',
                          color: 'white',
                          border: 'none',
                          borderRadius: '3px',
                          cursor: 'pointer'
                        }}
                      >
                        {isVisible ? '👁️' : '🙈'}
                      </button>
                      <input
                        type="text"
                        placeholder="Field Name"
                        value={fieldName}
                        onChange={(e) => onFieldNameChange(globalIndex, e.target.value)}
                        style={{
                          flex: 1,
                          padding: '3px 6px',
                          fontSize: '12px',
                          border: '1px solid #ccc',
                          borderRadius: '3px'
                        }}
                      />
                    </div>
                    <div 
                      className="text-content"
                      onClick={() => onTextClick(globalIndex)}
                      style={{ 
                        cursor: 'pointer',
                        padding: '3px',
                        borderRadius: '3px',
                        backgroundColor: highlightedDetectionIndex === globalIndex ? '#fffacd' : 'transparent'
                      }}
                    >
                      {detection.text}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
          {manualOcrResults.length > 0 && (
            <div className="manual-ocr-section">
              <h4>Manual Selections</h4>
              {manualOcrResults.map((detection, detectionIndex) => {
                const globalIndex = -1000 - detectionIndex;
                const isVisible = textItemStates[globalIndex]?.visible ?? true;
                const fieldName = textItemStates[globalIndex]?.fieldName ?? '';
                return (
                  <div 
                    key={`manual-${detectionIndex}`}
                    className={`text-item manual-selection ${
                      highlightedDetectionIndex === globalIndex ? 'highlighted' : ''
                    } ${!isVisible ? 'hidden-item' : ''}`}
                    style={{ 
                      border: '1px solid #28a745', 
                      margin: '5px 0', 
                      padding: '8px',
                      backgroundColor: isVisible ? '#e8f5e8' : '#f5f5f5',
                      opacity: isVisible ? 1 : 0.6
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '5px' }}>
                      <button
                        onClick={() => onTextItemToggle(globalIndex)}
                        style={{
                          marginRight: '8px',
                          padding: '2px 6px',
                          fontSize: '12px',
                          backgroundColor: isVisible ? '#28a745' : '#6c757d',
                          color: 'white',
                          border: 'none',
                          borderRadius: '3px',
                          cursor: 'pointer'
                        }}
                      >
                        {isVisible ? '👁️' : '🙈'}
                      </button>
                      <input
                        type="text"
                        placeholder="Field Name"
                        value={fieldName}
                        onChange={(e) => onFieldNameChange(globalIndex, e.target.value)}
                        style={{
                          flex: 1,
                          padding: '3px 6px',
                          fontSize: '12px',
                          border: '1px solid #28a745',
                          borderRadius: '3px',
                          backgroundColor: 'white'
                        }}
                      />
                    </div>
                    <div 
                      className="text-content"
                      onClick={() => onTextClick(globalIndex)}
                      style={{ 
                        cursor: 'pointer',
                        padding: '3px',
                        borderRadius: '3px',
                        backgroundColor: highlightedDetectionIndex === globalIndex ? '#fffacd' : 'transparent'
                      }}
                    >
                      {detection.text} (Manual)
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function App() {
  // File management
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileUrl, setFileUrl] = useState(null);
  const [fileType, setFileType] = useState('');
  
  // Job history refresh
  const jobHistoryRef = useRef(null);
  
  // Unified job status management
  const [currentJobId, setCurrentJobId] = useState(null);
  const [jobType, setJobType] = useState(null); // 'ocr' or 'llm'
  const [jobStatus, setJobStatus] = useState(null); // 'idle', 'processing', 'completed', 'error'
  const [globalLoading, setGlobalLoading] = useState(false);
  const [jobProgress, setJobProgress] = useState(null);
  
  // Results
  const [ocrResults, setOcrResults] = useState(null);
  const [llmResults, setLlmResults] = useState(null);
  const [error, setError] = useState('');
  
  // UI states
  const [showOcrResults, setShowOcrResults] = useState(true);
  const [showTextDialog, setShowTextDialog] = useState(false);
  const [highlightedDetectionIndex, setHighlightedDetectionIndex] = useState(null);
  const [showOnlyHighlighted, setShowOnlyHighlighted] = useState(false);
  const [isManualSelectionMode, setIsManualSelectionMode] = useState(false);
  const [manualOcrResults, setManualOcrResults] = useState([]);
  const [textItemStates, setTextItemStates] = useState({});
  const [showArchivedLlmDialog, setShowArchivedLlmDialog] = useState(false);

  const handleFileSelect = (file) => {
    setSelectedFile(file);
    setOcrResults(null);
    setLlmResults(null);
    setError('');
    setFileUrl(null);
    setFileType('');
    setManualOcrResults([]);
    setIsManualSelectionMode(false);
    setTextItemStates({});
    setCurrentJobId(null);
    setJobType(null);
    setJobStatus(null);
    setGlobalLoading(false);
    setJobProgress(null);
    setShowArchivedLlmDialog(false);
    
    if (file) {
      const url = URL.createObjectURL(file);
      setFileUrl(url);
      if (file.type.startsWith('image/')) {
        setFileType('image');
      } else if (file.type === 'application/pdf') {
        setFileType('pdf');
      } else {
        setError('Unsupported file type. Please upload an image or PDF.');
        setSelectedFile(null);
        setFileUrl(null);
      }
    }
  };

  const handleTextItemToggle = (globalIndex) => {
    setTextItemStates(prev => ({
      ...prev,
      [globalIndex]: {
        ...prev[globalIndex],
        visible: !(prev[globalIndex]?.visible ?? true)
      }
    }));
  };

  const handleFieldNameChange = (globalIndex, fieldName) => {
    setTextItemStates(prev => ({
      ...prev,
      [globalIndex]: {
        ...prev[globalIndex],
        fieldName: fieldName,
        visible: prev[globalIndex]?.visible ?? true
      }
    }));
  };

  const isTextItemVisible = (globalIndex) => {
    return textItemStates[globalIndex]?.visible ?? true;
  };

  const getTextItemFieldName = (globalIndex) => {
    return textItemStates[globalIndex]?.fieldName ?? '';
  };

  const refreshJobHistory = () => {
    if (jobHistoryRef.current && jobHistoryRef.current.refreshHistory) {
      console.log('🔄 App: Manually refreshing job history');
      jobHistoryRef.current.refreshHistory();
    }
  };

  const handleManualSelection = async (selection) => {
    try {
      setGlobalLoading(true);
      
      const canvas = selection.canvas;
      const imageDataUrl = canvas.toDataURL('image/png');
      
      const adjustedCoords = {
        startX: selection.startX,
        startY: selection.startY,
        endX: selection.endX,
        endY: selection.endY
      };
      
      const requestData = {
        page_data: imageDataUrl,
        coordinates: adjustedCoords,
        page_index: selection.pageIndex
      };
      
      const response = await axios.post('api/ocr/manual/', requestData, {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      });
      
      if (response.data.success) {
        const newResults = response.data.detections || [];
        setManualOcrResults(prev => [...prev, ...newResults]);
        console.log(`Manual OCR found ${newResults.length} text regions in selected area`);
      } else {
        setError(response.data.message || 'Manual OCR processing failed.');
      }
    } catch (err) {
      console.error("Manual OCR Error:", err);
      let errorMsg = 'Manual OCR processing failed.';
      if (err.response) {
        errorMsg = err.response.data.detail || err.response.data.message || `Server error: ${err.response.status}`;
      } else if (err.request) {
        errorMsg = 'No response from server. Check network or backend status.';
      }
      setError(errorMsg);
    }
    setGlobalLoading(false);
  };

  const downloadJsonResults = () => {
    if (!ocrResults && manualOcrResults.length === 0) {
      setError('No OCR results to download.');
      return;
    }
    try {
      const filteredAutomaticOcr = (ocrResults || []).map(page => ({
        ...page,
        detections: page.detections.map((detection, detectionIndex) => {
          const globalIndex = (page.page_number - 1) * 1000 + detectionIndex;
          const fieldName = getTextItemFieldName(globalIndex);
          return {
            ...detection,
            globalIndex,
            visible: isTextItemVisible(globalIndex),
            ...(fieldName && { field_name: fieldName })
          };
        }).filter(item => item.visible).map(({ visible, globalIndex, ...detection }) => detection)
      })).filter(page => page.detections.length > 0);

      const filteredManualOcr = manualOcrResults.map((detection, detectionIndex) => {
        const globalIndex = -1000 - detectionIndex;
        const fieldName = getTextItemFieldName(globalIndex);
        return {
          ...detection,
          globalIndex,
          visible: isTextItemVisible(globalIndex),
          ...(fieldName && { field_name: fieldName })
        };
      }).filter(item => item.visible).map(({ visible, globalIndex, ...detection }) => detection);

      const allResults = {
        automatic_ocr: filteredAutomaticOcr,
        manual_ocr: filteredManualOcr
      };

      const jsonString = JSON.stringify(allResults, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${selectedFile.name}_ocr_results.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Error generating JSON download:", e);
      setError("Could not prepare JSON for download.");
    }
  };
  
  // Clean up object URL on component unmount or when fileUrl changes
  React.useEffect(() => {
    return () => {
      if (fileUrl && fileUrl.startsWith('blob:')) {
        URL.revokeObjectURL(fileUrl);
      }
    };
  }, [fileUrl]);

  return (
    <div className="App">
      {/* Global Status Bar */}
      <GlobalStatusBar 
        globalLoading={globalLoading}
        jobType={jobType}
        currentJobId={currentJobId}
        jobProgress={jobProgress}
      />
      
      {/* Add top padding when status bar is visible */}
      <div style={{ paddingTop: globalLoading ? '60px' : '0', transition: 'padding-top 0.3s ease' }}>
        <header className="App-header">
          <h1>OnPrem Document AI Demo</h1>
        </header>
        
        <div className="container">
          {/* Widget 1: File Uploader */}
          <FileUploader 
            onFileSelect={handleFileSelect} 
            selectedFile={selectedFile}
          />

          {/* Widget 2: OCR Processor */}
          <OCRProcessor 
            selectedFile={selectedFile}
            globalLoading={globalLoading}
            setGlobalLoading={setGlobalLoading}
            setCurrentJobId={setCurrentJobId}
            jobType={jobType}
            setJobType={setJobType}
            setJobStatus={setJobStatus}
            setOcrResults={setOcrResults}
            setError={setError}
            onJobComplete={refreshJobHistory}
          />

          {/* Widget 3: LLM Processor */}
          <LLMProcessor 
            selectedFile={selectedFile}
            globalLoading={globalLoading}
            setGlobalLoading={setGlobalLoading}
            currentJobId={currentJobId}
            setCurrentJobId={setCurrentJobId}
            setJobType={setJobType}
            setJobStatus={setJobStatus}
            setLlmResults={setLlmResults}
            setError={setError}
            setJobProgress={setJobProgress}
          />

          {/* Widget 4: Job History */}
          <JobHistory 
            ref={jobHistoryRef}
            currentJobId={currentJobId}
            jobStatus={jobStatus}
            onJobSelect={(job, results) => {
              console.log('App: Job selected from history:', job, results);
              setCurrentJobId(job.job_id);
              setJobStatus(job.status);
              // Determine job type (simplified, might need more robust logic from job data)
              const selectedJobType = (job.processing_type === 'llm' || job.llm_model) ? 'llm' : 'ocr';
              setJobType(selectedJobType);

              if (selectedJobType === 'llm' && results && results.results && results.results.markdown_content) {
                setLlmResults(results.results); // Set the LLM results in App's state
                setShowArchivedLlmDialog(true); // Trigger dialog display
                setShowTextDialog(false); // Ensure other dialogs are closed
              } else {
                setLlmResults(null);
                setShowArchivedLlmDialog(false);
              }
              // If it's an OCR job, you might want to set ocrResults similarly
              if (selectedJobType === 'ocr' && results && results.results) {
                setOcrResults(results.results);
              } else if (selectedJobType !== 'llm') { // Clear OCR results if not an OCR job
                setOcrResults(null);
              }

            }}
            onJobDelete={(jobId) => {
              if (jobId === currentJobId) {
                setCurrentJobId(null);
                setJobStatus(null);
              }
            }}
          />

          {error && <p className="error-message">Error: {error}</p>}

          {(ocrResults && ocrResults.length > 0) || manualOcrResults.length > 0 ? (
            <div className="results-actions" style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '10px',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '20px 0',
              padding: '15px',
              backgroundColor: '#f8f9fa',
              borderRadius: '8px',
              border: '1px solid #dee2e6'
            }}>
              <button 
                onClick={() => setShowOcrResults(!showOcrResults)}
                disabled={globalLoading}
                style={{ 
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '8px 16px',
                  fontSize: '14px',
                  fontWeight: '500',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: globalLoading ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s ease',
                  backgroundColor: showOcrResults ? '#007bff' : '#6c757d',
                  color: 'white',
                  opacity: globalLoading ? 0.6 : 1,
                  width: '200px',
                  height: '48px',
                  justifyContent: 'center'
                }}
              >
                <span style={{ fontSize: '16px' }}>{showOcrResults ? '🙈' : '👁️'}</span>
                {showOcrResults ? 'Hide OCR Results' : 'Show OCR Results'}
              </button>
              <button 
                onClick={() => setIsManualSelectionMode(!isManualSelectionMode)}
                disabled={globalLoading}
                style={{ 
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '8px 16px',
                  fontSize: '14px',
                  fontWeight: '500',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: globalLoading ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s ease',
                  backgroundColor: isManualSelectionMode ? '#dc3545' : '#fd7e14',
                  color: 'white',
                  opacity: globalLoading ? 0.6 : 1,
                  width: '200px',
                  height: '48px',
                  justifyContent: 'center'
                }}
              >
                <span style={{ fontSize: '16px' }}>{isManualSelectionMode ? '❌' : '🎯'}</span>
                {isManualSelectionMode ? 'Exit Manual Selection' : 'Manual Selection Mode'}
              </button>
              <button 
                onClick={() => {
                  setShowTextDialog(true);
                  setShowOnlyHighlighted(false);
                  setHighlightedDetectionIndex(null);
                }}
                disabled={globalLoading}
                style={{ 
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '8px 16px',
                  fontSize: '14px',
                  fontWeight: '500',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: globalLoading ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s ease',
                  backgroundColor: '#28a745',
                  color: 'white',
                  opacity: globalLoading ? 0.6 : 1,
                  width: '200px',
                  height: '48px',
                  justifyContent: 'center'
                }}
              >
                <span style={{ fontSize: '16px' }}>📝</span>
                Select Necessary Fields
              </button>
              <button 
                onClick={downloadJsonResults} 
                disabled={globalLoading || (!ocrResults && manualOcrResults.length === 0)}
                style={{ 
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '8px 16px',
                  fontSize: '14px',
                  fontWeight: '500',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: (globalLoading || (!ocrResults && manualOcrResults.length === 0)) ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s ease',
                  backgroundColor: '#6f42c1',
                  color: 'white',
                  opacity: (globalLoading || (!ocrResults && manualOcrResults.length === 0)) ? 0.6 : 1,
                  width: '200px',
                  height: '48px',
                  justifyContent: 'center'
                }}
              >
                <span style={{ fontSize: '16px' }}>⬇️</span>
                Result Download (JSON)
              </button>
            </div>
          ) : null}

          {fileUrl && (
            <DocumentViewer 
              fileUrl={fileUrl} 
              fileType={fileType} 
              ocrResults={ocrResults}
              showOcrResults={showOcrResults}
              highlightedDetectionIndex={highlightedDetectionIndex}
              showOnlyHighlighted={showOnlyHighlighted}
              showTextDialog={showTextDialog}
              isManualSelectionMode={isManualSelectionMode}
              onManualSelection={handleManualSelection}
              manualOcrResults={manualOcrResults}
              isTextItemVisible={isTextItemVisible}
            />
          )}

          {isManualSelectionMode && (
            <div className="manual-selection-info" style={{
              marginTop: '10px',
              padding: '10px',
              backgroundColor: '#fff3cd',
              border: '1px solid #ffeaa7',
              borderRadius: '5px',
              fontSize: '14px'
            }}>
              <strong>Manual Selection Mode Active:</strong> Click and drag on the document to select an area for additional OCR processing.
              {manualOcrResults.length > 0 && (
                <div style={{ marginTop: '5px' }}>
                  Found {manualOcrResults.length} additional text region(s) from manual selections.
                </div>
              )}
            </div>
          )}

          {showTextDialog && (ocrResults || manualOcrResults.length > 0) && (
            <DraggableTextDialog 
              ocrResults={ocrResults || []}
              manualOcrResults={manualOcrResults}
              highlightedDetectionIndex={highlightedDetectionIndex}
              textItemStates={textItemStates}
              onTextItemToggle={handleTextItemToggle}
              onFieldNameChange={handleFieldNameChange}
              onClose={() => {
                setShowTextDialog(false);
                setShowOnlyHighlighted(false);
                setHighlightedDetectionIndex(null);
              }}
              onTextClick={(globalIndex) => {
                setHighlightedDetectionIndex(globalIndex);
                setShowOnlyHighlighted(true);
              }}
            />
          )}

          {/* Markdown Dialog for LLM results from Job History or active processing */}
          { (showArchivedLlmDialog || (jobType === 'llm' && llmResults?.markdown_content)) && llmResults?.markdown_content && (
            <LLMProcessor.MarkdownDialog // Assuming MarkdownDialog is exported or accessible
              markdownContent={llmResults.markdown_content}
              onClose={() => { 
                setShowArchivedLlmDialog(false); 
                setLlmResults(null); // Clear LLM results to ensure dialog closes
              }}
            />
          )}

        </div>
      </div>
    </div>
  );
}

export default App;