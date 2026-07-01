import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { ImagePickerAsset } from 'expo-image-picker';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';

export default function App() {
  const [images, setImages] = useState<ImagePickerAsset[]>([]);
  const [results, setResults] = useState<string[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isModelReady, setIsModelReady] = useState(false);
  const [modelStatus, setModelStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  
  const webviewRef = useRef<WebView>(null);

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (!isModelReady && modelStatus === 'loading') {
        setModelStatus('error');
        setIsModelReady(true);
      }
    }, 8000);

    return () => clearTimeout(timeout);
  }, [isModelReady, modelStatus]);

  // 1. Pick Images (Now requesting Base64 data so the AI can read it!)
  const pickImages = async () => {
    const slotsLeft = 10 - images.length;
    if (slotsLeft <= 0) {
      if (window.alert) window.alert("You can only upload a maximum of 10 images.");
      else Alert.alert("Limit Reached", "You can only upload a maximum of 10 images.");
      return;
    }

    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      alert("Please allow gallery access.");
      return;
    }

    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: slotsLeft,
      quality: 0.5, // Slightly compressed so 10 images don't crash the phone's memory
      base64: true, // CRITICAL: This turns the image into text for the AI
    });

    if (!result.canceled) {
      setImages([...images, ...result.assets]);
      setResults([]); 
    }
  };

  const removeImage = (indexToRemove: number) => {
    const updatedImages = images.filter((_, index) => index !== indexToRemove);
    setImages(updatedImages);
    setResults([]);
  };

  // 2. Send Images to the Invisible Web Browser for Real AI Analysis
  const analyzeImages = () => {
    if (images.length === 0) return;

    if (!isModelReady && modelStatus === 'loading') {
      Alert.alert("Please Wait", "The AI model is still loading. The app will continue once the connection is ready.");
      return;
    }
    
    setIsAnalyzing(true);

    // Extract just the raw base64 data from our images
    const base64Array = images.map(img => img.base64);
    
    // Send the array of images to the WebView
    webviewRef.current?.injectJavaScript(`
      predictImages(${JSON.stringify(base64Array)});
      true;
    `);
  };

  // 3. Receive the Results back from the WebView
  const handleWebViewMessage = (event: WebViewMessageEvent) => {
    const message = JSON.parse(event.nativeEvent.data);
    
    if (message.type === 'READY') {
      setIsModelReady(true);
      setModelStatus('ready');
      console.log("AI Model is fully loaded and ready!");
    } 
    else if (message.type === 'RESULTS') {
      setResults(message.data);
      setIsAnalyzing(false);
      setModelStatus('ready');
      setTimeout(() => Alert.alert("Analysis Complete", "Your AI model successfully classified these images!"), 100);
    } 
    else if (message.type === 'ERROR') {
      setIsAnalyzing(false);
      setModelStatus('error');
      setIsModelReady(true);
      setResults(images.map(() => 'Analysis unavailable in this environment. Please try again later.'));
      Alert.alert("AI Error", message.message);
    }
  };

  // ==========================================
  // INVISIBLE WEB BROWSER CODE (Your Teachable Machine Scripts!)
  // ==========================================
  const htmlContent = `
    <html>
      <head>
        <script src="https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@latest/dist/tf.min.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/@teachablemachine/image@latest/dist/teachablemachine-image.min.js"></script>
      </head>
      <body>
        <script>
          let model;
          const URL = "https://teachablemachine.withgoogle.com/models/3DDTBU46T/";
          // Load your specific AI model
          async function init() {
            try {
              model = await tmImage.load(URL + "model.json", URL + "metadata.json");
              window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'READY' }));
            } catch(e) {
              window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ERROR', message: "The AI model could not be loaded. The app will fall back to a non-blocking state." }));
            }
          }
          init();

          // Process the images sent from the mobile app
          async function predictImages(base64Array) {
            const allResults = [];

            if (!model) {
              window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ERROR', message: 'The AI model is not available right now.' }));
              return;
            }
            
            for (let i = 0; i < base64Array.length; i++) {
              await new Promise((resolve) => {
                const img = new Image();
                img.onload = async () => {
                  const prediction = await model.predict(img);
                  // Find the highest probability
                  let bestPrediction = prediction.reduce((prev, current) => 
                    (prev.probability > current.probability) ? prev : current
                  );
                  // Round the percentage
                  let percent = Math.round(bestPrediction.probability * 100);
                  allResults.push(bestPrediction.className + " (" + percent + "%)");
                  resolve();
                };
                img.src = "data:image/jpeg;base64," + base64Array[i];
              });
            }
            // Send the final answers back to the mobile app!
            window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'RESULTS', data: allResults }));
          }
        </script>
      </body>
    </html>
  `;

  return (
    <View style={styles.container}>
      {/* Invisible WebView Bridge */}
      <View style={{ height: 0, width: 0, opacity: 0 }}>
        <WebView
          ref={webviewRef}
          source={{ html: htmlContent }}
          onMessage={handleWebViewMessage}
          javaScriptEnabled={true}
        />
      </View>

      <View style={styles.header}>
        <Text style={styles.headerTitle}>SkinSense AI</Text>
        <Text style={styles.subTitle}>Upload photos for an instant preliminary screening.</Text>
        
        {/* Show a tiny status indicator for the AI Model */}
        {modelStatus === 'loading' ? (
          <Text style={{color: '#EAB308', fontSize: 12, marginTop: 5}}>Preparing AI model...</Text>
        ) : modelStatus === 'error' ? (
          <Text style={{color: '#F97316', fontSize: 12, marginTop: 5}}>AI model unavailable, using fallback mode.</Text>
        ) : null}
      </View>

      {images.length === 0 ? (
        <View style={styles.emptyStateContainer}>
          <Ionicons name="images-outline" size={60} color="#CBD5E1" />
          <Text style={styles.emptyStateText}>No images selected yet.</Text>
          <TouchableOpacity style={styles.primaryButton} onPress={pickImages}>
            <Ionicons name="add-circle-outline" size={20} color="#FFF" style={{marginRight: 8}} />
            <Text style={styles.primaryButtonText}>Select from Gallery</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.mainContent}>
          <ScrollView contentContainerStyle={styles.imageGrid}>
            {images.map((img, index) => (
              <View key={index} style={styles.imageCard}>
                <Image source={{ uri: img.uri }} style={styles.image} />
                
                {!isAnalyzing && (
                  <TouchableOpacity style={styles.deleteButton} onPress={() => removeImage(index)}>
                    <Ionicons name="close" size={16} color="#FFF" />
                  </TouchableOpacity>
                )}

                {isAnalyzing ? (
                  <ActivityIndicator size="small" color="#0EA5E9" style={{marginTop: 10}} />
                ) : (
                  results.length > 0 && results[index] ? (
                    <View style={styles.resultBadge}>
                      <Text style={styles.resultText}>{results[index]}</Text>
                    </View>
                  ) : null
                )}
              </View>
            ))}

            {images.length < 10 && !isAnalyzing && (
              <TouchableOpacity style={styles.addMoreCard} onPress={pickImages}>
                <Ionicons name="add" size={40} color="#94A3B8" />
                <Text style={styles.addMoreText}>Add More</Text>
              </TouchableOpacity>
            )}
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity 
              style={[
                styles.actionButton, 
                isAnalyzing && { backgroundColor: '#94A3B8' }
              ]} 
              onPress={analyzeImages}
              disabled={isAnalyzing}
            >
              {isAnalyzing ? (
                <Text style={styles.actionButtonText}>Analyzing with AI...</Text>
              ) : (
                <>
                  <Ionicons name="scan-outline" size={20} color="#FFF" style={{marginRight: 8}} />
                  <Text style={styles.actionButtonText}>Analyze {images.length} Image(s)</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC', paddingTop: 40 },
  header: { paddingHorizontal: 20, paddingBottom: 20, alignItems: 'center', backgroundColor: '#F8FAFC', borderBottomWidth: 1, borderColor: '#E2E8F0' },
  headerTitle: { fontSize: 28, fontWeight: '800', color: '#0F172A', letterSpacing: 0.5 },
  subTitle: { fontSize: 14, color: '#64748B', marginTop: 6, textAlign: 'center' },
  emptyStateContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 },
  emptyStateText: { fontSize: 16, color: '#94A3B8', marginTop: 15, marginBottom: 25 },
  primaryButton: { flexDirection: 'row', backgroundColor: '#0EA5E9', paddingVertical: 14, paddingHorizontal: 24, borderRadius: 30, alignItems: 'center', elevation: 5 },
  primaryButtonText: { color: '#FFF', fontSize: 16, fontWeight: 'bold' },
  mainContent: { flex: 1, justifyContent: 'space-between' },
  imageGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: 20, paddingBottom: 120, justifyContent: 'center' },
  imageCard: { width: 140, margin: 10, backgroundColor: '#FFF', borderRadius: 15, padding: 10, alignItems: 'center', elevation: 2 },
  image: { width: 120, height: 120, borderRadius: 10 },
  addMoreCard: { width: 140, height: 140, margin: 10, backgroundColor: '#F1F5F9', borderRadius: 15, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#E2E8F0', borderStyle: 'dashed', marginTop: 10 },
  deleteButton: { position: 'absolute', top: -5, right: -5, backgroundColor: '#EF4444', width: 28, height: 28, borderRadius: 14, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#FFF', elevation: 4, zIndex: 5 },
  addMoreText: { color: '#94A3B8', fontWeight: 'bold', marginTop: 5 },
  resultBadge: { marginTop: 10, backgroundColor: '#F0FDF4', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 20, borderWidth: 1, borderColor: '#BBF7D0', width: '100%' },
  resultText: { fontSize: 12, fontWeight: 'bold', color: '#166534', textAlign: 'center' },
  footer: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 20, backgroundColor: '#FFF', borderTopWidth: 1, borderColor: '#E2E8F0', zIndex: 10 },
  actionButton: { flexDirection: 'row', backgroundColor: '#10B981', paddingVertical: 16, borderRadius: 30, justifyContent: 'center', alignItems: 'center', elevation: 5 },
  actionButtonText: { color: '#FFF', fontSize: 18, fontWeight: 'bold' }
});