// frontend/src/App.jsx
import React, { useState, useCallback } from 'react';
import axios from 'axios';
import FileUploader from './components/FileUploader';
import DocumentViewer from './components/DocumentViewer';
import './App.css'; // Specific styles for App component

function App() {
  const [selectedFile, setSelectedFile] = useState(null);
  const [ocrResults, setOcrResults] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [fileUrl, setFileUrl] = useState(null); // For displaying the uploaded image/PDF
  const [fileType, setFileType] = useState(''); // 'image' or 'pdf'

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
        timeout: 120000, // 2 minutes timeout for large PDFs
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
        {loading && <p className="loading-message">Processing, please wait...</p>}

        {ocrResults && ocrResults.length > 0 && (
          <div className="results-actions">
            <button onClick={downloadJsonResults} disabled={loading || !ocrResults}>
              Download OCR JSON Results
            </button>
          </div>
        )}

        {fileUrl && (
          <DocumentViewer 
            fileUrl={fileUrl} 
            fileType={fileType} 
            ocrResults={ocrResults}
          />
        )}
      </div>
    </div>
  );
}

export default App;
