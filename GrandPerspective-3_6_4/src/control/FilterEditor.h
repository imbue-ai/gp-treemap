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

@class FilterWindowControl;
@class FilterRepository;
@class NamedFilter;

/* Helper class for editing filters. For a clean separation of concerns, the EditFilterWindowControl
 * only manages the process editing of a single filter, without concerning itself with the large
 * context (i.e. the filter repository that the filter will be added to). The interaction with the
 * filter repository (e.g. ensuring that the name of a new filter does not clash with that of an
 * existing one) is the responsibility of this class.
 */
@interface FilterEditor : NSObject {
  FilterRepository  *filterRepository;
  
  FilterWindowControl  *filterWindowControl;
}

- (instancetype) init;
- (instancetype) initWithFilterRepository:(FilterRepository *)filterRepository NS_DESIGNATED_INITIALIZER;

/* Edits a new filter. It returns the new filter, or "nil" if the action was cancelled. It updates
 * the repository. The repository's NotifyingDictionary will fire an "objectAdded" event in
 * response.
 */
- (NamedFilter *)createNamedFilter;

/* Edits an existing filter with the given name. The filter should exist in the filter repository.
 * It returns the modified filter, or "nil" if the action was cancelled. It updates the filter in
 * the repository. Its NotifyingDictionary will fire the appropriate event(s) in response.
 */
- (NamedFilter *)editFilterNamed:(NSString *)oldName;

@end
