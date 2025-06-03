// frontend/src/App.jsx
import React, { useState, useCallback, useRef } from 'react';
import axios from 'axios';
import FileUploader from './components/FileUploader';
import DocumentViewer from './components/DocumentViewer';
import './App.css'; // Specific styles for App component

// Draggable Text Dialog Component
function DraggableTextDialog({ ocrResults, highlightedDetectionIndex, onClose, onTextClick }) {
  const [position, setPosition] = useState({ x: 100, y: 100 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const dialogRef = useRef(null);

  const handleMouseDown = (e) => {
    if (e.target.closest('.text-dialog-content') || e.target.closest('.close-button')) {
      return; // Don't start dragging if clicking on content or close button
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
                return (
                  <div 
                    key={detectionIndex}
                    className={`text-line ${
                      highlightedDetectionIndex === globalIndex ? 'highlighted' : ''
                    }`}
                    onClick={() => onTextClick(globalIndex)}
                  >
                    {detection.text}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function App() {
  const [selectedFile, setSelectedFile] = useState(null);
  const [ocrResults, setOcrResults] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [fileUrl, setFileUrl] = useState(null); // For displaying the uploaded image/PDF
  const [fileType, setFileType] = useState(''); // 'image' or 'pdf'
  const [showOcrResults, setShowOcrResults] = useState(true); // Toggle for OCR result visibility
  const [showTextDialog, setShowTextDialog] = useState(false);
  const [highlightedDetectionIndex, setHighlightedDetectionIndex] = useState(null);
  const [showOnlyHighlighted, setShowOnlyHighlighted] = useState(false);

  const handleFileSelect = (file) => {
    setSelectedFile(file);
    setOcrResults(null);
    setError('');
    setFileUrl(null);
    setFileType('');
    if (file) {
      // Create a URL for the selected file to display it
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

  const handleUpload = async () => {
    if (!selectedFile) {
      setError('Please select a file first.');
      return;
    }
    if (fileType === '' && !selectedFile.type.startsWith('image/') && selectedFile.type !== 'application/pdf') {
        setError('Unsupported file type. Please upload an image or PDF.');
        return;
    }

    setLoading(true);
    setError('');
    setOcrResults(null);

    const formData = new FormData();
    formData.append('file', selectedFile);

    try {
      const response = await axios.post(`api/ocr/process/`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        timeout: 300000, // 5 minutes timeout for large PDFs
      });
      
      console.log("Backend Response:", response.data);

      if (response.data.success) {
        setOcrResults(response.data.results);
        setError(''); // Clear any previous errors
      } else {
        setError(response.data.message || 'OCR processing failed.');
        setOcrResults(null);
      }
    } catch (err) {
      console.error("Upload Error:", err);
      let errorMsg = 'An error occurred during upload.';
      if (err.response) {
        errorMsg = err.response.data.detail || err.response.data.message || `Server error: ${err.response.status}`;
      } else if (err.request) {
        errorMsg = 'No response from server. Check network or backend status.';
      }
      setError(errorMsg);
      setOcrResults(null);
    }
    setLoading(false);
  };

  const downloadJsonResults = () => {
    if (!ocrResults) {
      setError('No OCR results to download.');
      return;
    }
    try {
      const jsonString = JSON.stringify(ocrResults, null, 2);
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
      <header className="App-header">
        <h1>Full-Stack OCR Application</h1>
      </header>
      <div className="container">
        <FileUploader 
          onFileSelect={handleFileSelect} 
          onUpload={handleUpload} 
          loading={loading} 
          selectedFile={selectedFile}
        />

        {error && <p className="error-message">Error: {error}</p>}
        {loading && (
          <div className="loading-message">
            <p>Processing {fileType === 'pdf' ? 'PDF document' : 'image'}, please wait...</p>
            {fileType === 'pdf' && (
              <p style={{ fontSize: '0.9em', color: '#666' }}>
                PDF processing may take several minutes depending on the number of pages.
              </p>
            )}
          </div>
        )}

        {ocrResults && ocrResults.length > 0 && (
          <div className="results-actions">
            <button onClick={downloadJsonResults} disabled={loading || !ocrResults}>
              Download OCR JSON Results
            </button>
            <button 
              onClick={() => setShowOcrResults(!showOcrResults)}
              disabled={loading}
              style={{ 
                marginLeft: '10px',
                backgroundColor: showOcrResults ? '#007bff' : '#6c757d'
              }}
            >
              {showOcrResults ? 'Hide OCR Results' : 'Show OCR Results'}
            </button>
            <button 
              onClick={() => {
                setShowTextDialog(true);
                setShowOnlyHighlighted(false);
                setHighlightedDetectionIndex(null);
              }}
              disabled={loading}
              style={{ 
                marginLeft: '10px',
                backgroundColor: '#28a745'
              }}
            >
              Display Detected Text
            </button>
          </div>
        )}

        {fileUrl && (
          <DocumentViewer 
            fileUrl={fileUrl} 
            fileType={fileType} 
            ocrResults={ocrResults}
            showOcrResults={showOcrResults && !showTextDialog}
            highlightedDetectionIndex={highlightedDetectionIndex}
            showOnlyHighlighted={showOnlyHighlighted}
          />
        )}

        {showTextDialog && ocrResults && (
          <DraggableTextDialog 
            ocrResults={ocrResults}
            highlightedDetectionIndex={highlightedDetectionIndex}
            onClose={() => setShowTextDialog(false)}
            onTextClick={(globalIndex) => {
              setHighlightedDetectionIndex(globalIndex);
              setShowOnlyHighlighted(true);
            }}
          />
        )}
      </div>
    </div>
  );
}

export default App;
