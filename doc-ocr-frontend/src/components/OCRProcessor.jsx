import React from 'react';
import axios from 'axios';

function OCRProcessor({ 
  selectedFile,
  globalLoading,
  setGlobalLoading,
  setCurrentJobId,
  jobType,
  setJobType,
  setJobStatus,
  setOcrResults,
  setError,
  onJobComplete
}) {

  const handleOcrUpload = async () => {
    console.log('🔵 OCR: Starting OCR upload process');
    console.log('🔵 OCR: Selected file:', selectedFile?.name);
    console.log('🔵 OCR: Current global loading state:', globalLoading);
    
    if (!selectedFile) {
      setError('Please select a file first.');
      return;
    }

    if (!selectedFile.type.startsWith('image/') && selectedFile.type !== 'application/pdf') {
      setError('Unsupported file type. Please upload an image or PDF.');
      return;
    }

    console.log('🔵 OCR: Setting global loading to true');
    setGlobalLoading(true);
    setJobType('ocr');
    setJobStatus('processing');
    setError('');
    setOcrResults(null);

    const formData = new FormData();
    formData.append('file', selectedFile);

    try {
      console.log('🔵 OCR: Sending request to backend');
      const response = await axios.post(`api/ocr/process/`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        timeout: 300000, // 5 minutes timeout for large PDFs
      });
      
      console.log('🔵 OCR: Backend Response:', response.data);

      if (response.data.success) {
        console.log('🔵 OCR: Success! Setting results and completed status');
        console.log('🔵 OCR: Received job_id from backend:', response.data.job_id);
        setOcrResults(response.data.results);
        setJobStatus('completed');
        setError('');
        
        // Set the job ID from the response so it appears in history
        if (response.data.job_id) {
          setCurrentJobId(response.data.job_id);
          console.log('🔵 OCR: Set current job ID to:', response.data.job_id);
        }
        
        // Trigger job history refresh since OCR completes immediately
        if (onJobComplete) {
          console.log('🔵 OCR: Calling onJobComplete callback to refresh history');
          onJobComplete();
        }
        
        console.log('🔵 OCR: About to set global loading to false');
      } else {
        console.log('🔵 OCR: Failed response from backend');
        setError(response.data.message || 'OCR processing failed.');
        setOcrResults(null);
        setJobStatus('error');
        setCurrentJobId(null); // Clear job ID on error
      }
    } catch (err) {
      console.error('🔴 OCR: Upload Error:', err);
      let errorMsg = 'An error occurred during OCR processing.';
      if (err.response) {
        errorMsg = err.response.data.detail || err.response.data.message || `Server error: ${err.response.status}`;
      } else if (err.request) {
        errorMsg = 'No response from server. Check network or backend status.';
      }
      setError(errorMsg);
      setOcrResults(null);
      setJobStatus('error');
      setCurrentJobId(null); // Clear job ID on error
    }
    
    console.log('🔵 OCR: Setting global loading to false');
    setGlobalLoading(false);
  };

  return (
    <div style={{
      margin: '20px 0',
      padding: '20px',
      backgroundColor: '#f8f9fa',
      borderRadius: '8px',
      border: '1px solid #dee2e6'
    }}>
      <h3 style={{ marginBottom: '15px', color: '#495057' }}>OCR Processor</h3>
      
      <button 
        onClick={handleOcrUpload}
        disabled={globalLoading || !selectedFile}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '12px 24px',
          fontSize: '16px',
          fontWeight: '500',
          border: 'none',
          borderRadius: '6px',
          cursor: (globalLoading || !selectedFile) ? 'not-allowed' : 'pointer',
          transition: 'all 0.2s ease',
          backgroundColor: globalLoading ? '#6c757d' : '#28a745',
          color: 'white',
          opacity: (globalLoading || !selectedFile) ? 0.6 : 1,
          width: '100%',
          justifyContent: 'center'
        }}
      >
        <span style={{ fontSize: '18px' }}>📄</span>
        {globalLoading && jobType === 'ocr' ? 'Processing OCR...' : 'Upload and Start OCR Process'}
      </button>

      {!selectedFile && (
        <p style={{ 
          marginTop: '10px', 
          fontSize: '14px', 
          color: '#6c757d',
          fontStyle: 'italic' 
        }}>
          Please select a file first to start OCR processing.
        </p>
      )}
    </div>
  );
}

export default OCRProcessor;