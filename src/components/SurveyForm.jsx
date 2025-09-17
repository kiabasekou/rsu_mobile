// ===== 4. COMPOSANT COLLECTE ENQUÊTE =====
// components/SurveyForm.jsx
import React, { useState, useEffect, useRef } from 'react';
import { View, ScrollView, Alert, BackHandler } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { updateSessionResponse, completeSession, addMediaFile } from '../store/slices/surveysSlice';
import { requestLocationPermission, getCurrentLocation } from '../services/locationService';
import { QuestionRenderer } from './QuestionRenderer';
import { ProgressBar } from './ProgressBar';
import { SyncIndicator } from './SyncIndicator';
import { ValidationSummary } from './ValidationSummary';

export const SurveyForm = ({ sessionId, navigation }) => {
  const dispatch = useDispatch();
  const session = useSelector(state => 
    state.surveys.currentSession?.id === sessionId ? state.surveys.currentSession : 
    state.surveys.activeSessions.find(s => s.id === sessionId)
  );
  
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [validationErrors, setValidationErrors] = useState({});
  const [isValidating, setIsValidating] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  
  const scrollViewRef = useRef();
  const template = useSelector(state => 
    state.surveys.templates.find(t => t.id === session?.templateId)
  );
  
  useEffect(() => {
    // Géolocalisation au début
    initializeLocation();
    
    // Gestion retour Android
    const backHandler = BackHandler.addEventListener('hardwareBackPress', handleBackPress);
    return () => backHandler.remove();
  }, []);
  
  useEffect(() => {
    // Auto-validation temps réel
    if (isDirty) {
      const timer = setTimeout(() => {
        validateCurrentResponse();
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [session?.responses, currentQuestionIndex, isDirty]);
  
  const initializeLocation = async () => {
    try {
      const hasPermission = await requestLocationPermission();
      if (hasPermission) {
        const location = await getCurrentLocation();
        // Stocker localisation de démarrage
        dispatch(updateSessionResponse({
          sessionId,
          questionId: '_start_location',
          response: {
            type: 'GPS',
            value: location,
            timestamp: new Date().toISOString()
          }
        }));
      }
    } catch (error) {
      console.warn('Erreur géolocalisation:', error);
    }
  };
  
  const handleBackPress = () => {
    if (isDirty) {
      Alert.alert(
        'Modifications non sauvegardées',
        'Vous avez des modifications non sauvegardées. Que voulez-vous faire ?',
        [
          { text: 'Continuer', style: 'cancel' },
          { text: 'Sauvegarder et quitter', onPress: saveAndExit },
          { text: 'Quitter sans sauvegarder', onPress: () => navigation.goBack(), style: 'destructive' }
        ]
      );
      return true;
    }
    return false;
  };
  
  const saveAndExit = () => {
    // Auto-save de la session en cours
    setIsDirty(false);
    navigation.goBack();
  };
  
  const validateCurrentResponse = async () => {
    if (!template?.questions_config || !session) return;
    
    setIsValidating(true);
    const currentQuestion = template.questions_config[currentQuestionIndex];
    const response = session.responses[currentQuestion.question_id];
    
    try {
      // Validation locale avec les règles
      const validation = await validateResponse(currentQuestion, response?.value);
      
      setValidationErrors(prev => ({
        ...prev,
        [currentQuestion.question_id]: validation
      }));
      
    } catch (error) {
      console.error('Erreur validation:', error);
    } finally {
      setIsValidating(false);
    }
  };
  
  const handleResponseChange = (questionId, value, additionalData = {}) => {
    const response = {
      type: template.questions_config[currentQuestionIndex].type,
      value,
      timestamp: new Date().toISOString(),
      ...additionalData
    };
    
    dispatch(updateSessionResponse({
      sessionId,
      questionId,
      response
    }));
    
    setIsDirty(true);
    
    // Auto-progression pour certains types
    const currentQuestion = template.questions_config[currentQuestionIndex];
    if (currentQuestion.auto_advance && value !== null && value !== '') {
      setTimeout(() => {
        nextQuestion();
      }, 500);
    }
  };
  
  const handleMediaCapture = (questionId, mediaFile) => {
    dispatch(addMediaFile({
      sessionId,
      mediaFile: {
        questionId,
        mediaType: mediaFile.type,
        originalFilename: mediaFile.fileName || `${questionId}_${Date.now()}.${mediaFile.type}`,
        mimeType: mediaFile.type === 'photo' ? 'image/jpeg' : 'audio/mp4',
        uri: mediaFile.uri,
        fileSize: mediaFile.fileSize || 0
      }
    }));
    
    // Aussi mettre à jour la réponse
    handleResponseChange(questionId, mediaFile.uri, {
      mediaType: mediaFile.type,
      fileName: mediaFile.fileName
    });
  };
  
  const nextQuestion = () => {
    if (currentQuestionIndex < template.questions_config.length - 1) {
      setCurrentQuestionIndex(prev => prev + 1);
      scrollViewRef.current?.scrollTo({ y: 0, animated: true });
    } else {
      // Fin du questionnaire
      handleCompleteSurvey();
    }
  };
  
  const previousQuestion = () => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(prev => prev - 1);
      scrollViewRef.current?.scrollTo({ y: 0, animated: true });
    }
  };
  
  const handleCompleteSurvey = () => {
    Alert.alert(
      'Terminer l\'enquête',
      'Êtes-vous sûr de vouloir terminer cette enquête ? Elle sera marquée comme complétée.',
      [
        { text: 'Continuer l\'enquête', style: 'cancel' },
        { text: 'Terminer', onPress: completeSurvey, style: 'default' }
      ]
    );
  };
  
  const completeSurvey = async () => {
    try {
      // Validation finale complète
      const finalValidation = await validateCompleteSurvey();
      
      if (finalValidation.hasErrors) {
        Alert.alert(
          'Erreurs de validation',
          'L\'enquête contient des erreurs. Voulez-vous la compléter quand même ?',
          [
            { text: 'Corriger', style: 'cancel' },
            { text: 'Compléter quand même', onPress: forceComplete }
          ]
        );
        return;
      }
      
      // Capture de localisation finale
      const endLocation = await getCurrentLocation();
      dispatch(updateSessionResponse({
        sessionId,
        questionId: '_end_location',
        response: {
          type: 'GPS',
          value: endLocation,
          timestamp: new Date().toISOString()
        }
      }));
      
      dispatch(completeSession(sessionId));
      setIsDirty(false);
      
      Alert.alert(
        'Enquête terminée',
        'L\'enquête a été marquée comme complétée et sera synchronisée dès que possible.',
        [{ text: 'OK', onPress: () => navigation.navigate('SurveyList') }]
      );
      
    } catch (error) {
      Alert.alert('Erreur', 'Impossible de terminer l\'enquête: ' + error.message);
    }
  };
  
  const forceComplete = () => {
    dispatch(completeSession(sessionId));
    setIsDirty(false);
    navigation.navigate('SurveyList');
  };
  
  const validateCompleteSurvey = async () => {
    // Validation globale de toutes les réponses
    const errors = [];
    const warnings = [];
    
    for (const question of template.questions_config) {
      const response = session.responses[question.question_id];
      
      if (question.required && (!response || response.value === null || response.value === '')) {
        errors.push(`Question "${question.question_text}" est obligatoire`);
      }
      
      if (response?.value) {
        const validation = await validateResponse(question, response.value);
        if (validation.errors?.length > 0) {
          errors.push(...validation.errors);
        }
        if (validation.warnings?.length > 0) {
          warnings.push(...validation.warnings);
        }
      }
    }
    
    return {
      hasErrors: errors.length > 0,
      errors,
      warnings
    };
  };
  
  if (!session || !template) {
    return <LoadingSpinner />;
  }
  
  const currentQuestion = template.questions_config[currentQuestionIndex];
  const progress = ((currentQuestionIndex + 1) / template.questions_config.length) * 100;
  const currentResponse = session.responses[currentQuestion.question_id];
  
  return (
    <View style={styles.container}>
      {/* Header avec progression */}
      <View style={styles.header}>
        <ProgressBar progress={progress} />
        <SyncIndicator sessionId={sessionId} />
      </View>
      
      {/* Contenu principal */}
      <ScrollView 
        ref={scrollViewRef}
        style={styles.scrollView}
        keyboardShouldPersistTaps="handled"
      >
        <QuestionRenderer
          question={currentQuestion}
          value={currentResponse?.value}
          onChange={(value, additional) => 
            handleResponseChange(currentQuestion.question_id, value, additional)
          }
          onMediaCapture={(mediaFile) => 
            handleMediaCapture(currentQuestion.question_id, mediaFile)
          }
          validationErrors={validationErrors[currentQuestion.question_id]}
          isValidating={isValidating}
        />
        
        {/* Résumé validation */}
        <ValidationSummary 
          errors={validationErrors[currentQuestion.question_id]}
        />
      </ScrollView>
      
      {/* Navigation */}
      <View style={styles.navigation}>
        <Button
          title="Précédent"
          onPress={previousQuestion}
          disabled={currentQuestionIndex === 0}
          style={styles.navButton}
        />
        
        <Text style={styles.questionCounter}>
          {currentQuestionIndex + 1} / {template.questions_config.length}
        </Text>
        
        {currentQuestionIndex === template.questions_config.length - 1 ? (
          <Button
            title="Terminer"
            onPress={handleCompleteSurvey}
            style={[styles.navButton, styles.completeButton]}
          />
        ) : (
          <Button
            title="Suivant"
            onPress={nextQuestion}
            style={styles.navButton}
          />
        )}
      </View>
    </View>
  );
};