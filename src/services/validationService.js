// ===== 6. VALIDATION OFFLINE =====
// services/validationService.js
import { ResponseValidator, LocationValidator, ConsistencyValidator } from './validators';

class OfflineValidationService {
  constructor() {
    this.responseValidator = new ResponseValidator();
    this.locationValidator = new LocationValidator();
    this.consistencyValidator = new ConsistencyValidator();
    
    // Cache des règles de validation
    this.validationRulesCache = new Map();
  }
  
  async validateResponse(questionConfig, value, context = {}) {
    try {
      // Validation basique du type
      const typeValidation = await this.responseValidator.validate_response(questionConfig, value);
      
      // Validation contextuelle
      const contextValidation = await this.validateContext(questionConfig, value, context);
      
      // Validation métier offline
      const businessValidation = await this.validateBusinessRules(questionConfig, value, context);
      
      return {
        valid: typeValidation.valid && contextValidation.valid && businessValidation.valid,
        errors: [
          ...(typeValidation.errors || []),
          ...(contextValidation.errors || []),
          ...(businessValidation.errors || [])
        ],
        warnings: [
          ...(typeValidation.warnings || []),
          ...(contextValidation.warnings || []),
          ...(businessValidation.warnings || [])
        ]
      };
      
    } catch (error) {
      console.error('Erreur validation offline:', error);
      return {
        valid: true, // Passer en mode permissif si erreur validation
        errors: [],
        warnings: ['Erreur validation - vérification manuelle requise']
      };
    }
  }
  
  async validateContext(questionConfig, value, context) {
    const errors = [];
    const warnings = [];
    
    // Validation géolocalisation si requis
    if (questionConfig.requires_location && context.location) {
      const locationValidation = await this.locationValidator.validate_location_data(
        context.location, 
        context.assignedRegions
      );
      
      if (!locationValidation.valid) {
        errors.push(...locationValidation.errors);
        warnings.push(...locationValidation.warnings);
      }
    }
    
    // Validation dépendances
    if (questionConfig.depends_on && context.allResponses) {
      const dependencyValidation = this.validateDependencies(
        questionConfig, 
        value, 
        context.allResponses
      );
      
      errors.push(...dependencyValidation.errors);
      warnings.push(...dependencyValidation.warnings);
    }
    
    return { valid: errors.length === 0, errors, warnings };
  }
  
  validateDependencies(questionConfig, value, allResponses) {
    const errors = [];
    const warnings = [];
    
    const dependency = questionConfig.depends_on;
    const dependentValue = allResponses[dependency.question_id]?.value;
    
    // Skip validation si question dépendante pas encore répondue
    if (dependentValue === undefined || dependentValue === null) {
      return { errors, warnings };
    }
    
    // Vérifier condition de dépendance
    const conditionMet = this.evaluateCondition(dependency.condition, dependentValue);
    
    if (dependency.required_if && conditionMet && !value) {
      errors.push(`Cette question est obligatoire quand ${dependency.description}`);
    }
    
    if (dependency.forbidden_if && conditionMet && value) {
      errors.push(`Cette question ne doit pas être remplie quand ${dependency.description}`);
    }
    
    return { errors, warnings };
  }
  
  evaluateCondition(condition, value) {
    switch (condition.operator) {
      case 'equals':
        return value === condition.value;
      case 'not_equals':
        return value !== condition.value;
      case 'in':
        return condition.values.includes(value);
      case 'not_in':
        return !condition.values.includes(value);
      case 'greater_than':
        return parseFloat(value) > parseFloat(condition.value);
      case 'less_than':
        return parseFloat(value) < parseFloat(condition.value);
      default:
        return false;
    }
  }
  
  async validateBusinessRules(questionConfig, value, context) {
    const errors = [];
    const warnings = [];
    
    // Règles métier spécifiques Gabon
    if (questionConfig.type_context === 'nip') {
      const nipValidation = this.validateNIP(value);
      if (!nipValidation.valid) {
        errors.push(...nipValidation.errors);
      }
    }
    
    if (questionConfig.type_context === 'phone_number') {
      const phoneValidation = this.validateGabonesePhone(value);
      if (!phoneValidation.valid) {
        warnings.push(...phoneValidation.warnings);
      }
    }
    
    if (questionConfig.type_context === 'income') {
      const incomeValidation = this.validateIncome(value, context);
      warnings.push(...incomeValidation.warnings);
    }
    
    return { valid: errors.length === 0, errors, warnings };
  }
  
  validateNIP(nip) {
    if (!nip || typeof nip !== 'string') {
      return { valid: false, errors: ['NIP requis'] };
    }
    
    // Format NIP gabonais (à ajuster selon spécifications exactes)
    const nipPattern = /^[0-9]{13}$/;
    if (!nipPattern.test(nip)) {
      return { 
        valid: false, 
        errors: ['Format NIP invalide (13 chiffres attendus)'] 
      };
    }
    
    // Validation checksum si applicable
    // TODO: Implémenter selon algorithme RBPP
    
    return { valid: true, errors: [] };
  }
  
  validateGabonesePhone(phone) {
    if (!phone) return { valid: true, warnings: [] };
    
    const warnings = [];
    
    // Patterns téléphones gabonais
    const gabonMobilePattern = /^(\+241|241)?[01567][0-9]{7}$/;
    const cleanPhone = phone.replace(/[\s\-\(\)]/g, '');
    
    if (!gabonMobilePattern.test(cleanPhone)) {
      warnings.push('Format téléphone gabonais non reconnu');
    }
    
    return { valid: true, warnings };
  }
  
  validateIncome(income, context) {
    const warnings = [];
    const amount = parseFloat(income);
    
    if (isNaN(amount)) return { warnings };
    
    // Seuils de référence Gabon (à ajuster selon données officielles)
    const minWage = 150000; // SMIG Gabon approximatif
    const averageIncome = 300000;
    const highIncome = 1000000;
    
    if (amount > 0 && amount < minWage) {
      warnings.push('Revenu inférieur au SMIG - vérifier');
    }
    
    if (amount > highIncome) {
      warnings.push('Revenu très élevé - vérifier');
    }
    
    // Cohérence avec contexte familial
    if (context.householdSize && amount > 0) {
      const incomePerPerson = amount / context.householdSize;
      if (incomePerPerson < 50000) {
        warnings.push('Revenu par personne très faible');
      }
    }
    
    return { warnings };
  }
}

export const validationService = new OfflineValidationService();