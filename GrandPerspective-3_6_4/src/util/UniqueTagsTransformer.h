/* GrandPerspective, Version 3.6.4 
 *   A utility for macOS that graphically shows disk usage. 
 * Copyright (C) 2005-2025, Erwin Bonsma 
 * 
 * This program is free software; you can redistribute it and/or modify it 
 * under the terms of the GNU General Public License as published by the Free 
 * Software Foundation; either version 2 of the License, or (at your option) 
 * any later version. 
 * 
 * This program is distributed in the hope that it will be useful, but WITHOUT 
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or 
 * FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License for 
 * more details. 
 * 
 * You should have received a copy of the GNU General Public License along 
 * with this program; if not, write to the Free Software Foundation, Inc., 
 * 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA. 
 */

#import <Cocoa/Cocoa.h>

/* A transformer that converts values (typically strings) to unique integer values. Once a value has
 * been assigned an integer tag, it always transforms to the same value. Furthermore, the reverse
 * transformation can then be used to get the original value again.
 *
 * This may all sound very abstract, but is in fact tremendously useful. It can be used for
 * localizing controls, in particular PopUpButtons. Each option is represented by a
 * locale-independent base name. These base names are used internally by the application, for
 * example to store preference values in a locale-independent, human-readable format.
 *
 * Localized pop-up buttons can be created as follows. It is populated by menu items, where each
 * title is a localized version of the base name, and where each tag derived from the basename.
 * These tags can be used to determine the base name corresponding to a selected item. (Note that
 * mapping localized names to base names directly does not work that well, because there can be
 * multiple base names that map to the same localized string).
 */
@interface UniqueTagsTransformer : NSValueTransformer {
  NSMutableDictionary  *valueToTag;
  NSMutableDictionary  *tagToValue;
  
  NSUInteger  nextTag;
}

@property (class, nonatomic, readonly) UniqueTagsTransformer *defaultUniqueTagsTransformer;

/* Uses the transformer to add localized items to the pop-up. Each item has a tag associated with it
 * that allows easy mapping back to the original, locale-independent name. The items are sorted by
 * their localized name.
 *
 * @param names       The locale-independent names
 * @param popUp       The pop-up to populate
 * @param selectName  Indicates which value to select (by its locale-independent name)
 * @param tableName   The localization table to use
 */
- (void) addLocalisedNamesFor:(NSArray *)names
                      toPopUp:(NSPopUpButton *)popUp
                       select:(NSString *)selectName
                        table:(NSString *)tableName;

/* Adds a single item to a pop-up. It preserves the sorting (assuming that the items are sorted by
 * name).
 */
- (void) addLocalisedNameFor:(NSString *)name
                     toPopUp:(NSPopUpButton *)popUp
                      select:(BOOL)select
                       table:(NSString *)tableName;

/* Adds items to the pop-up, preserving the order in which the names are sorted.
 */
- (void) addSortedLocalisedNamesFor:(NSArray *)names
                            toPopUp:(NSPopUpButton *)popUp
                             select:(NSString *)selectName
                              table:(NSString *)tableName;

/* Lower-level method. It can be used to populate pop-ups (partially) with non-localized values,
 * for example numeric values.
 */
- (void) addValue:(NSObject *)value
        withTitle:(NSString *)title
          toPopUp:(NSPopUpButton *)popUp
          atIndex:(int)index
           select:(BOOL)select;

/* Returns the locale-independent name for the given item. This works as long as the item was
 * created by this transformer using the -addLocalisedNames:toPopUp:names:select:table method.
 */
- (NSString *)nameForTag:(NSUInteger)tag;

/* Returns the tag for the locale-independent name.
 */
- (NSUInteger) tagForName:(NSString *)name;

/* Generic variants of nameForTag and tagForWhen, when addValue:withTitle:toPopup:atIndex:select was
 * used directly to populate the pop-up.
 */
- (NSObject *)valueForTag:(NSUInteger)tag;
- (NSUInteger) tagForValue:(NSObject *)value;

@end
