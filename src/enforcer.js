/*
Copyright 2017 Google Inc.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    https://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

/* eslint-disable no-unused-vars */
import {TrustedTypeConfig} from './data/trustedtypeconfig.js';
import {TrustedTypes} from './trustedtypes.js';

/* eslint-enable no-unused-vars */
import {installFunction, installSetter} from './utils/wrapper.js';

const {apply} = Reflect;
const {getOwnPropertyNames, hasOwnProperty} = Object;

/**
 * A map of attribute names to allowed types.
 * @type {!Object<string, !Object<string, !Function>>}
 */
const SET_ATTRIBUTE_TYPE_MAP = {
  // TODO(slekies): Add event handlers
  // TODO(slekies): Add SVG Elements here
  'HTMLAnchorElement': {
    'href': TrustedTypes.TrustedURL,
  },
  'HTMLAreaElement': {
    'href': TrustedTypes.TrustedURL,
  },
  'HTMLBaseElement': {
    'href': TrustedTypes.TrustedURL,
  },
  'HTMLSourceElement': {
    'src': TrustedTypes.TrustedURL,
  },
  'HTMLImageElement': {
    'src': TrustedTypes.TrustedURL,
    // TODO(slekies): add special handling for srcset
  },
  'HTMLTrackElement': {
    'src': TrustedTypes.TrustedURL,
  },
  'HTMLMediaElement': {
    'src': TrustedTypes.TrustedURL,
  },
  'HTMLInputElement': {
    'src': TrustedTypes.TrustedURL,
  },
  'HTMLFrameElement': {
    'src': TrustedTypes.TrustedURL,
  },
  'HTMLIFrameElement': {
    'src': TrustedTypes.TrustedURL,
    'srcdoc': TrustedTypes.TrustedHTML,
  },
  'HTMLLinkElement': {
    'href': TrustedTypes.TrustedScriptURL,
  },
  'HTMLObjectElement': {
    'data': TrustedTypes.TrustedScriptURL,
    'codebase': TrustedTypes.TrustedScriptURL,
  },
  'HTMLEmbedElement': {
    'src': TrustedTypes.TrustedScriptURL,
  },
  'HTMLScriptElement': {
    'src': TrustedTypes.TrustedScriptURL,
  },
};

/**
 * Map of type names to type checking function.
 * @type {!Object<string,!Function>}
 */
const TYPE_CHECKER_MAP = {
  'TrustedHTML': TrustedTypes.isHTML,
  'TrustedURL': TrustedTypes.isURL,
  'TrustedScriptURL': TrustedTypes.isScriptURL,
};

/**
 * Map of type names to type producing function.
 * @type {Object<string,!Function>}
 */
const TYPE_PRODUCER_MAP = {
  'TrustedHTML': TrustedTypes.createHTML,
  'TrustedURL': TrustedTypes.createURL,
  'TrustedScriptURL': TrustedTypes.createScriptURL,
};

/**
 * A map of HTML attribute to element property names.
 * @type {!Object<string, string>}
 */
const ATTR_PROPERTY_MAP = {
  'codebase': 'codeBase',
};

/**
 * An object for enabling trusted type enforcement.
 */
export class TrustedTypesEnforcer {
  /**
   * @param {!TrustedTypeConfig} config The configuration for
   * trusted type enforcement.
   */
  constructor(config) {
    /**
     * A configuration for the trusted type enforcement.
     * @private {!TrustedTypeConfig}
     */
    this.config_ = config;
    /**
     * @private {Object<string, !function(*): *|undefined>}
     */
    this.originalSetters_ = {};
  }

  /**
   * Wraps HTML sinks with an enforcement setter, which will enforce
   * trusted types and do logging, if enabled.
   */
  install() {
    this.wrapSetter_(Element.prototype, 'innerHTML', TrustedTypes.TrustedHTML);
    this.wrapSetter_(Element.prototype, 'outerHTML', TrustedTypes.TrustedHTML);
    this.wrapWithEnforceFunction_(Range.prototype, 'createContextualFragment',
        TrustedTypes.TrustedHTML, 0);
    this.wrapWithEnforceFunction_(Element.prototype, 'insertAdjacentHTML',
        TrustedTypes.TrustedHTML, 1);
    this.wrapSetAttribute_();
    this.installPropertySetWrappers_();
  }

  /**
   * Removes the original setters.
   */
  uninstall() {
    this.restoreSetter_(Element.prototype, 'innerHTML');
    this.restoreSetter_(Element.prototype, 'outerHTML');
    this.restoreFunction_(Range.prototype, 'createContextualFragment');
    this.restoreFunction_(Element.prototype, 'insertAdjacentHTML');
    this.restoreFunction_(Element.prototype, 'setAttribute');
    this.restoreFunction_(Element.prototype, 'setAttributeNS');
    this.uninstallPropertySetWrappers_();
  }

  /**
   * Installs wrappers for directly setting properties
   * based on SET_ATTRIBUTE_TYPE_MAP.
   * @private
   */
  installPropertySetWrappers_() {
    /* eslint-disable guard-for-in */
    for (let type of getOwnPropertyNames(SET_ATTRIBUTE_TYPE_MAP)) {
      for (let attribute of getOwnPropertyNames(SET_ATTRIBUTE_TYPE_MAP[type])) {
        const property = apply(hasOwnProperty, ATTR_PROPERTY_MAP, [attribute]) ?
              ATTR_PROPERTY_MAP[attribute] : attribute;
        this.wrapSetter_(window[type].prototype, property,
                         SET_ATTRIBUTE_TYPE_MAP[type][attribute]);
      }
    }
  }

  /**
   * Uninstalls wrappers for directly setting properties
   * based on SET_ATTRIBUTE_TYPE_MAP.
   * @private
   */
  uninstallPropertySetWrappers_() {
    /* eslint-disable guard-for-in */
    for (let type of getOwnPropertyNames(SET_ATTRIBUTE_TYPE_MAP)) {
      for (let attribute of getOwnPropertyNames(SET_ATTRIBUTE_TYPE_MAP[type])) {
        const property = attribute in ATTR_PROPERTY_MAP ?
              ATTR_PROPERTY_MAP[attribute] : attribute;
        this.restoreSetter_(window[type].prototype, property);
      }
    }
  }

  /** Wraps set attribute with an enforcement function. */
  wrapSetAttribute_() {
    let that = this;
    this.wrapFunction_(
        Element.prototype,
        'setAttribute',
        /**
         * @this {TrustedTypesEnforcer}
         * @param {!Function<!Function, *>} originalFn
         * @return {*}
         */
        function(originalFn, ...args) {
          return that.setAttributeWrapper_
              .bind(that, this, originalFn)
              .apply(that, args);
        });
    this.wrapFunction_(
      Element.prototype,
      'setAttributeNS',
      /**
         * @this {TrustedTypesEnforcer}
         * @param {!Function<!Function, *>} originalFn
         * @return {*}
         */
        function(originalFn, ...args) {
          return that.setAttributeNSWrapper_
              .bind(that, this, originalFn)
              .apply(that, args);
        });
  }

  /**
   * Enforces type checking for Element.prototype.setAttribute.
   * @param {!Object} context The context for the call to the original function.
   * @param {!Function} originalFn The original setAttribute function.
   * @return {*}
   */
  setAttributeWrapper_(context, originalFn, ...args) {
    // Note(slekies): In a normal application constructor should never be null.
    // However, there are no guarantees. If the constructor is null, we cannot
    // determine whether a special type is required. In order to not break the
    // application, we will not do any further type checks and pass the call
    // to setAttribute.
    if (context.constructor !== null) {
      let attrName = (args[0] = String(args[0])).toLowerCase();
      let type = context.constructor && context.constructor.name &&
          SET_ATTRIBUTE_TYPE_MAP[context.constructor.name] &&
          SET_ATTRIBUTE_TYPE_MAP[context.constructor.name][attrName];

      if (type instanceof Function) {
        return this.enforce_(
          context, 'setAttribute', type, originalFn, 1, args);
      }
    }

    return originalFn.apply(context, args);
  }

  /**
   * Enforces type checking for Element.prototype.setAttributeNS.
   * @param {!Object} context The context for the call to the original function.
   * @param {!Function} originalFn The original setAttributeNS function.
   * @return {*}
   */
  setAttributeNSWrapper_(context, originalFn, ...args) {
    /**
     * @param {string} ns the namespace URL.
     * @return {boolean} true iff the given argument is an HTML namespace.
     */
    function isHtmlNamespace(ns) {
      return true; // TODO(msamuel): implement me
    }
    // See the note from setAttributeWrapper_ above.
    if (context.constructor !== null) {
      let ns = (args[0] = String(args[0])).toLowerCase();
      let attrName = (args[1] = String(args[1])).toLowerCase();
      if (isHtmlNamespace(ns)) {
        let type = context.constructor && context.constructor.name &&
            SET_ATTRIBUTE_TYPE_MAP[context.constructor.name] &&
            SET_ATTRIBUTE_TYPE_MAP[context.constructor.name][attrName];

        if (type instanceof Function) {
          return this.enforce_(
            context, 'setAttributeNS', type, originalFn, 2, args);
        }
      }
      // TODO(msamuel): handle SVG namespace.  See TODO(slekies) above.
    }

    return originalFn.apply(context, args);
  }


  /**
   * Wraps a setter with the enforcement wrapper.
   * @param {!Object} object The object of the to-be-wrapped property.
   * @param {string} name The name of the property.
   * @param {!Function} type The type to enforce.
   * @param {number} argNumber Number of the argument to enforce the type of.
   * @private
   */
  wrapWithEnforceFunction_(object, name, type, argNumber) {
    let that = this;
    this.wrapFunction_(
        object,
        name,
        /**
         * @this {TrustedTypesEnforcer}
         * @param {!Function<!Function, *>} originalFn
         * @return {*}
         */
        function(originalFn, ...args) {
          return that.enforce_.call(that, this, name, type, originalFn,
                                    argNumber, args);
        });
  }


  /**
   * Wraps an existing function with a given function body and stores the
   * original function.
   * @param {!Object} object The object of the to-be-wrapped property.
   * @param {string} name The name of the property.
   * @param {!Function<!Function, *>} functionBody The wrapper function.
   */
  wrapFunction_(object, name, functionBody) {
    let originalFn = /** @type function(*):* */ (
        Object.getOwnPropertyDescriptor(object, name).value);

    if (!(originalFn instanceof Function)) {
      throw new TypeError(
          'Property ' + name + ' on object' + object + ' is not a function');
    }

    let key = this.getKey_(object, name);
    if (this.originalSetters_[key]) {
      throw new Error('TrustedTypesEnforcer: Double installation detected');
    }
    installFunction(
        object,
        name,
        /**
         * @this {TrustedTypesEnforcer}
         * @return {*}
         */
        function(...args) {
          return functionBody.bind(this, originalFn).apply(this, args);
        });
    this.originalSetters_[key] = originalFn;
  }

  /**
   * Wraps a setter with the enforcement wrapper.
   * @param {!Object} object The object of the to-be-wrapped property.
   * @param {string} name The name of the property.
   * @param {!Function} type The type to enforce.
   * @private
   */
  wrapSetter_(object, name, type) {
    let originalSetter = /** @type {!Function} */
        (Object.getOwnPropertyDescriptor(object, name).set);
    let key = this.getKey_(object, name);
    if (this.originalSetters_[key]) {
      throw new Error('TrustedTypesEnforcer: Double installation detected');
    }
    let that = this;
    installSetter(
        object,
        name,
        /**
         * @this {TrustedTypesEnforcer}
         * @param {*} value
         */
        function(value) {
          that.enforce_.call(that, this, name, type, originalSetter, 0,
                             [value]);
        });
    this.originalSetters_[key] = originalSetter;
  }

  /**
   * Restores the original setter for the property, as encountered during
   * install().
   * @param {!Object} object The object of the to-be-wrapped property.
   * @param {string} name The name of the property.
   * @private
   */
  restoreSetter_(object, name) {
    let key = this.getKey_(object, name);
    if (!this.originalSetters_[key]) {
      throw new Error(
          'TrustedTypesEnforcer: Cannot restore (double uninstallation?)');
    }
    installSetter(object, name, this.originalSetters_[key]);
    delete this.originalSetters_[key];
  }

  /**
   * Restores the original method of an object, as encountered during install().
   * @param {!Object} object The object of the to-be-wrapped property.
   * @param {string} name The name of the property.
   * @private
   */
  restoreFunction_(object, name) {
    let key = this.getKey_(object, name);
    if (!this.originalSetters_[key]) {
      throw new Error(
          'TrustedTypesEnforcer: Cannot restore (double uninstallation?)');
    }
    installFunction(object, name, this.originalSetters_[key]);
    delete this.originalSetters_[key];
  }

  /**
   * Returns the key name for caching original setters.
   * @param {!Object} object The object of the to-be-wrapped property.
   * @param {string} name The name of the property.
   * @return {string} Key name.
   * @private
   */
  getKey_(object, name) {
    // TODO(msamuel): Can we use Object.prototype.toString.call(object)
    // to get an unspoofable string here?
    // TODO(msamuel): fail on '-' in object.constructor.name?
    return '' + object.constructor.name + '-' + name;
  }

  /**
   * Logs and enforces TrustedTypes depending on the given configuration.
   * @template T
   * @param {!Object} context The object that the setter is called for.
   * @param {string} propertyName The name of the property.
   * @param {!Function} typeToEnforce The type to enforce.
   * @param {!function(*):T} originalSetter Original setter.
   * @param {number} argNumber Number of argument to enforce the type of.
   * @param {Array} args Arguments.
   * @return {T}
   * @private
   */
  enforce_(context, propertyName, typeToEnforce, originalSetter, argNumber,
           args) {
    let value = args[argNumber];
    const typeName = '' + typeToEnforce.name;
    if (TYPE_CHECKER_MAP.hasOwnProperty(typeName) &&
        TYPE_CHECKER_MAP[typeName](value)) {
      return apply(originalSetter, context, args);
    }

    const fallback = this.config_.fallbackPolicyName;
    if (fallback && TrustedTypes.getPolicyNames().includes(fallback)) {
      let fallbackValue = TYPE_PRODUCER_MAP[typeName](fallback, value);
      if (TYPE_CHECKER_MAP.hasOwnProperty(typeName) &&
          TYPE_CHECKER_MAP[typeName](fallbackValue)) {
        args[argNumber] = fallbackValue;
        return apply(originalSetter, context, args);
      }
    }

    let message = 'Failed to set ' + propertyName + ' property on ' +
        ('' + context || context.constructor.name) +
        ': This document requires `' + (typeToEnforce.name) + '` assignment.';

    if (this.config_.isLoggingEnabled) {
      // eslint-disable-next-line no-console
      console.warn(message, propertyName, context, typeToEnforce, value);
    }

    if (this.config_.isEnforcementEnabled) {
      throw new TypeError(message);
    }
  }
}